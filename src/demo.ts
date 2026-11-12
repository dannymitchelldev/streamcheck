import type { Fetcher } from '@openrouter/sdk/lib/http.js';
import { inputFailure, runWithTransport } from './runner.js';
import type { DemoOptions, DemoScenario, RunResult } from './types.js';

const scenarios = ['success', 'auth-failure', 'rate-limit', 'interrupted'] as const;

function demoChunk(content: string, finishReason: string | null = null, error?: { code: number; message: string }) {
  return {
    id: 'gen-streamcheck-offline', object: 'chat.completion.chunk', created: 1,
    model: 'streamcheck/demo', choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
    ...(error ? { error } : {}),
  };
}

/** Four fixed wire fixtures, deliberately not a general-purpose SSE simulator. */
function demoFetcher(scenario: DemoScenario): Fetcher {
  return async input => {
    if (!(input instanceof Request) || input.url !== 'https://openrouter.ai/api/v1/chat/completions' || input.method !== 'POST') {
      throw new Error('Unexpected offline request; no network fallback');
    }
    if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (scenario === 'auth-failure' || scenario === 'rate-limit') {
      const status = scenario === 'auth-failure' ? 401 : 429;
      return new Response(JSON.stringify({ error: { code: status, message: 'Synthetic offline failure' } }), {
        status, headers: { 'content-type': 'application/json' },
      });
    }

    const frames = [
      demoChunk('Webhooks send HTTP notifications'),
      demoChunk(scenario === 'success' ? ' when an event happens.\n' : ' when an event'),
      scenario === 'success' ? demoChunk('', 'stop') : demoChunk('', 'error', { code: 502, message: 'Synthetic provider failure' }),
      '[DONE]',
    ];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const dispose = () => { closed = true; clearTimeout(timer); input.signal.removeEventListener('abort', onAbort); };
    const onAbort = () => { if (!closed) { dispose(); body.error(new DOMException('Aborted', 'AbortError')); } };
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
        input.signal.addEventListener('abort', onAbort, { once: true });
        const send = (index: number) => {
          timer = setTimeout(() => {
            if (closed) return;
            const frame = frames[index];
            body.enqueue(new TextEncoder().encode(`data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`));
            if (index === frames.length - 1) { dispose(); body.close(); }
            else send(index + 1);
          }, index === 0 ? 80 : index === frames.length - 1 ? 0 : 100);
        };
        if (input.signal.aborted) onAbort(); else send(0);
      },
      cancel: dispose,
    });
    return new Response(responseBody, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

export function runDemo(options: DemoOptions = {}): Promise<RunResult> {
  if (!options || typeof options !== 'object') return Promise.resolve(inputFailure('Demo options must be an object', 'demo'));
  const live = { ...options, apiKey: 'streamcheck-offline-only', model: 'streamcheck/demo', prompt: 'Explain webhooks' };
  if (options.signal instanceof AbortSignal && options.signal.aborted) return runWithTransport(live, undefined, 'demo');
  const scenario = options.scenario ?? 'interrupted';
  if (!scenarios.includes(scenario)) return Promise.resolve(inputFailure('Choose success, auth-failure, rate-limit, or interrupted', 'demo', 'streamcheck/demo'));
  return runWithTransport(live, demoFetcher(scenario), 'demo');
}

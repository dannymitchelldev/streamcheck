import type { Fetcher } from '@openrouter/sdk/lib/http.js';

export function chunk(content = '', finishReason: string | null = null, extra: Record<string, unknown> = {}) {
  return {
    id: 'gen-offline', object: 'chat.completion.chunk', created: 1,
    model: 'streamcheck/demo', choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
    ...extra,
  };
}

export function sse(...events: unknown[]): Response {
  const wire = events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
  return new Response(wire, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export function fixedFetcher(response: Response): Fetcher {
  return async input => {
    if (!(input instanceof Request) || input.method !== 'POST' || input.url !== 'https://openrouter.ai/api/v1/chat/completions') {
      throw new Error('Unexpected fixture request; no network fallback');
    }
    return response;
  };
}

export function controlledResponse() {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let cancellations = 0;
  let resolveRequest!: (request: Request) => void;
  const requested = new Promise<Request>(resolve => { resolveRequest = resolve; });
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { body = controller; },
    cancel() { closed = true; cancellations++; },
  }), { headers: { 'content-type': 'text/event-stream' } });
  const fetcher: Fetcher = async input => {
    resolveRequest(input as Request);
    return fixedFetcher(response)(input);
  };
  return {
    fetcher, requested,
    emit(event: unknown) { if (!closed) body.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); },
    raw(wire: string) { if (!closed) body.enqueue(new TextEncoder().encode(wire)); },
    end() { if (!closed) { closed = true; body.close(); } },
    fail() { if (!closed) { closed = true; body.error(new TypeError('terminated', { cause: { code: 'ECONNRESET' } })); } },
    get cancellations() { return cancellations; },
  };
}

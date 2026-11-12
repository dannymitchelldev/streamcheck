import type { Fetcher } from '@openrouter/sdk/lib/http.js';
import type { ChatStreamChunk } from '@openrouter/sdk/models';
import { validateHeaderValue } from 'node:http';
import { createSdk } from './sdk.js';
import type { Diagnostic, FailureResult, LiveOptions, ResultBase, RunResult, RunSource, WarningCode } from './types.js';

const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 2_147_483_647;
const DEFAULT_MAX_TOKENS = 256;

export function inputFailure(message: string, source: RunSource | null = null, model: string | null = null): FailureResult {
  return {
    schemaVersion: 1, source, model, outcome: 'failed', text: '', partialOutput: false,
    firstTokenMs: null, elapsedMs: 0, httpStatus: null, finishReason: null, warnings: [],
    error: { kind: 'input', phase: 'setup', message },
  };
}

function validate(options: LiveOptions): string | null {
  if (!options || typeof options !== 'object') return 'Run options are required';
  if (typeof options.apiKey !== 'string' || !options.apiKey.trim()) return 'An OpenRouter API key is required';
  try {
    const headers = new Headers({ authorization: `Bearer ${options.apiKey}` });
    validateHeaderValue('authorization', headers.get('authorization') ?? '');
  }
  catch { return 'The OpenRouter API key contains invalid HTTP header characters'; }
  if (typeof options.model !== 'string' || !options.model.trim()) return 'A nonempty model is required';
  if (typeof options.prompt !== 'string' || !options.prompt.trim()) return 'A nonempty prompt is required';
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > MAX_TIMEOUT)) return 'Timeout must be an integer from 1 to 2147483647 milliseconds';
  if (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0)) return 'Maximum tokens must be a positive safe integer';
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) return 'Signal must be an AbortSignal';
  if (options.onText !== undefined && typeof options.onText !== 'function') return 'onText must be a synchronous function';
  return null;
}

type Terminal = { outcome: 'success' } | { outcome: 'cancelled'; reason: 'caller' } | { outcome: 'error'; error: Diagnostic };

/** Internal transport seam; not exported from the package's public interface. */
export async function runWithTransport(options: LiveOptions, fetcher?: Fetcher, source: RunSource = 'live'): Promise<RunResult> {
  const startedAt = performance.now();
  const model = typeof options?.model === 'string' ? options.model : null;
  const empty = inputFailure('', source, model);
  if (options?.signal instanceof AbortSignal && options.signal.aborted) {
    const { outcome: _outcome, error: _error, ...base } = empty;
    return { ...base, outcome: 'cancelled', reason: 'caller', elapsedMs: performance.now() - startedAt };
  }
  const invalid = validate(options);
  if (invalid) return { ...inputFailure(invalid, source, model), elapsedMs: performance.now() - startedAt };

  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<ChatStreamChunk> | undefined;
  let cancelling: Promise<void> | undefined;
  let terminal: Terminal | undefined;
  let finishedAt = startedAt;
  let text = '';
  let firstTokenMs: number | null = null;
  let httpStatus: number | null = null;
  let finishReason: string | null = null;
  let normalReason: string | null = null;
  let phase: Diagnostic['phase'] = 'request';
  const warnings: WarningCode[] = [];

  const cancelReader = () => {
    if (reader && !cancelling) cancelling = reader.cancel().catch(() => { /* preserve the accepted outcome */ });
  };
  const accept = (candidate: Terminal) => {
    if (terminal) return;
    terminal = candidate;
    finishedAt = performance.now();
    if (candidate.outcome !== 'success') {
      // Store the cause before transport abort generates its own rejection.
      abort.abort(candidate.outcome === 'cancelled' ? 'caller' : candidate.error.kind);
      cancelReader();
    }
  };
  const fail = (kind: Diagnostic['kind'], message: string, code?: number) => {
    accept({ outcome: 'error', error: { kind, phase, message, ...(code !== undefined ? { code } : {}) } });
  };
  const onCallerAbort = () => { accept({ outcome: 'cancelled', reason: 'caller' }); };
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  // Also close the check/listen gap for signals aborted by caller-side code.
  if (options.signal?.aborted) onCallerAbort();
  const deadline = setTimeout(() => { fail('timeout', 'Overall streaming deadline exceeded'); }, options.timeoutMs ?? DEFAULT_TIMEOUT);

  try {
    if (!terminal) {
      const sdk = createSdk(options.apiKey, fetcher, response => {
        httpStatus = response.status;
        if (response.ok && response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) phase = 'stream';
      });
      const stream = await sdk.chat.send({
        chatRequest: {
          model: options.model,
          messages: [{ role: 'user', content: options.prompt }],
          stream: true,
          maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        },
      }, { signal: abort.signal, retries: { strategy: 'none' } });
      if (!(stream instanceof ReadableStream)) {
        fail('protocol', 'Expected a streaming response');
      } else {
        phase = 'stream';
        reader = stream.getReader();
        if (terminal) cancelReader();
        while (!terminal) {
          const next = await reader.read();
          if (terminal) break;
          if (next.done) {
            if (normalReason) accept({ outcome: 'success' });
            else fail('protocol', 'Stream ended without an observed normal finish reason');
            break;
          }
          const value = next.value;
          // The request asks for one text completion. Never merge alternatives or
          // let another choice's finish reason certify choice zero's text.
          if (value.choices.length > 1 || value.choices.some(choice => choice.index !== 0)) {
            fail('protocol', 'Expected at most one completion choice with index zero');
            break;
          }
          const selected = value.choices[0];
          // Keep observed metadata even if the text callback ends this run.
          const observedReason = selected?.finishReason;
          if (finishReason === null && observedReason) finishReason = observedReason;
          const delta = selected?.delta.content;
          if (typeof delta === 'string' && delta.length > 0) {
            if (firstTokenMs === null) firstTokenMs = performance.now() - startedAt;
            text += delta;
            try { options.onText?.(delta); }
            catch { fail('consumer', 'The synchronous onText callback failed'); }
          }
          if (terminal) break;
          if (value.error) {
            fail('provider', 'Provider error during streaming', value.error.code);
            break;
          }
          for (const choice of value.choices) {
            if (choice.delta.toolCalls?.length || choice.finishReason === 'tool_calls') {
              fail('protocol', 'Tool calls are unsupported by this text-only operation');
              break;
            }
            const reason = choice.finishReason;
            if (reason === null) continue;
            if (reason === 'error') { fail('provider', 'Provider error during streaming'); break; }
            if (reason !== 'stop' && reason !== 'length' && reason !== 'content_filter') {
              fail('protocol', 'An unsupported finish reason was observed');
              break;
            }
            if (normalReason && normalReason !== reason) { fail('protocol', 'Conflicting normal finish reasons were observed'); break; }
            normalReason = reason;
            const warning = reason === 'length' ? 'token_limit' : reason === 'content_filter' ? 'content_filter' : null;
            if (warning && !warnings.includes(warning)) warnings.push(warning);
          }
        }
      }
    }
  } catch (error: unknown) {
    if (!terminal) {
      const name = error instanceof Error ? error.name : '';
      if (httpStatus !== null && (httpStatus < 200 || httpStatus >= 300)) {
        fail('http', `HTTP request failed (${httpStatus})`);
      } else if (name === 'ZodError' || name === 'ResponseValidationError' || name === 'OpenRouterDefaultError' || name === 'SyntaxError') {
        fail('protocol', 'The SDK rejected a malformed or unsupported response');
      } else if (name === 'SDKValidationError' || name === 'InvalidRequestError') {
        accept({ outcome: 'error', error: { kind: 'input', phase: 'setup', message: 'The SDK rejected the request configuration' } });
      } else if (name === 'RequestTimeoutError' || name === 'TimeoutError') {
        fail('timeout', 'The HTTP request timed out');
      } else if (name === 'ConnectionError' || name === 'RequestAbortedError' || name === 'AbortError' || name === 'TypeError') {
        fail('network', phase === 'stream' ? 'Stream connection interrupted' : 'Unable to connect to OpenRouter');
      } else {
        fail('internal', 'An unexpected client error occurred');
      }
    }
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', onCallerAbort);
    cancelReader();
    await cancelling;
    reader?.releaseLock();
  }

  const accepted = terminal ?? { outcome: 'error' as const, error: { kind: 'internal' as const, phase, message: 'No terminal result was accepted' } };
  const base: ResultBase = {
    schemaVersion: 1, source, model, text,
    partialOutput: text.length > 0 && accepted.outcome !== 'success',
    firstTokenMs, elapsedMs: Math.max(0, finishedAt - startedAt), httpStatus, finishReason, warnings,
  };
  if (accepted.outcome === 'success') return { ...base, outcome: 'success' };
  if (accepted.outcome === 'cancelled') return { ...base, outcome: 'cancelled', reason: 'caller' };
  return { ...base, outcome: text.length > 0 ? 'interrupted' : 'failed', error: accepted.error };
}

export function runStreamCheck(options: LiveOptions): Promise<RunResult> {
  return runWithTransport(options);
}

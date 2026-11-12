import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithTransport } from '../src/runner.js';
import type { LiveOptions } from '../src/types.js';
import { chunk, controlledResponse, fixedFetcher, sse } from './helpers.js';

const valid: LiveOptions = { apiKey: 'synthetic-key-never-print', model: 'streamcheck/demo', prompt: 'offline test' };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('result and stream boundaries', () => {
  it('preserves exact text, ignores accounting duplicates, and measures the first text delta', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const fixture = controlledResponse();
    const received: string[] = [];
    const pending = runWithTransport({ ...valid, onText: text => { received.push(text); } }, fixture.fetcher);
    await fixture.requested;
    fixture.raw(': OPENROUTER PROCESSING\n\n');
    fixture.emit(chunk(''));
    await vi.advanceTimersByTimeAsync(42);
    fixture.emit(chunk('Hello '));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(58);
    fixture.emit(chunk('🌍', 'stop'));
    fixture.emit(chunk('', 'stop', { usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }));
    fixture.end();
    const result = await pending;
    expect(result).toMatchObject({ outcome: 'success', text: 'Hello 🌍', partialOutput: false, firstTokenMs: 42, elapsedMs: 100, httpStatus: 200, finishReason: 'stop', warnings: [] });
    expect(received).toEqual(['Hello ', '🌍']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([['length', 'token_limit'], ['content_filter', 'content_filter']] as const)('warns for %s without marking successful text partial', async (reason, warning) => {
    const result = await runWithTransport(valid, fixedFetcher(sse(chunk('Received', reason), '[DONE]')));
    expect(result).toMatchObject({ outcome: 'success', partialOutput: false, warnings: [warning], finishReason: reason });
  });

  it('allows a normally finished empty response with a null first-token time', async () => {
    const result = await runWithTransport(valid, fixedFetcher(sse(chunk('', 'content_filter'), '[DONE]')));
    expect(result).toMatchObject({ outcome: 'success', text: '', partialOutput: false, firstTokenMs: null, warnings: ['content_filter'] });
  });

  it.each([401, 429, 503])('reports HTTP %i without text and without retry or raw error disclosure', async status => {
    const fetcher = vi.fn(fixedFetcher(new Response(JSON.stringify({ error: { code: status, message: 'RAW-SDK-DETAIL-DO-NOT-EMIT' } }), { status, headers: { 'content-type': 'application/json' } })));
    const result = await runWithTransport(valid, fetcher);
    expect(result).toMatchObject({ outcome: 'failed', text: '', partialOutput: false, firstTokenMs: null, httpStatus: status, error: { kind: 'http', phase: 'request' } });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(/synthetic-key|RAW-SDK-DETAIL/);
  });

  it.each(['', 'Partial text'])('classifies an HTTP 200 provider error after %j without guessing from HTTP status', async text => {
    const result = await runWithTransport(valid, fixedFetcher(sse(chunk(text), chunk('', 'error', { error: { code: 502, message: 'Private upstream detail' } }))));
    expect(result).toMatchObject({ outcome: text ? 'interrupted' : 'failed', text, partialOutput: Boolean(text), httpStatus: 200, error: { kind: 'provider', phase: 'stream', code: 502 } });
    expect(JSON.stringify(result)).not.toContain('Private upstream detail');
  });

  it.each([
    ['data: not-json\n\n', 'protocol'],
    [`data: ${JSON.stringify(chunk('', 'error', { error: { code: 'server_error', message: 'Rejected shape' } }))}\n\n`, 'protocol'],
  ])('preserves text when SDK parsing rejects a later payload', async (wire, kind) => {
    const fixture = controlledResponse();
    const pending = runWithTransport(valid, fixture.fetcher);
    await fixture.requested;
    fixture.emit(chunk('Retain this'));
    fixture.raw(wire);
    fixture.end();
    expect(await pending).toMatchObject({ outcome: 'interrupted', text: 'Retain this', partialOutput: true, httpStatus: 200, error: { kind, phase: 'stream' } });
  });

  it.each(['', 'Unfinished'])('does not confuse EOF without a finish reason with success', async text => {
    const result = await runWithTransport(valid, fixedFetcher(sse(chunk(text))));
    expect(result).toMatchObject({ outcome: text ? 'interrupted' : 'failed', text, error: { kind: 'protocol', phase: 'stream' } });
  });

  it('records the accepted SDK blind spot after an observed finish reason', async () => {
    const response = new Response(`data: ${JSON.stringify(chunk('Complete', 'stop'))}\n\ndata: {"error":`, { headers: { 'content-type': 'text/event-stream' } });
    expect(await runWithTransport(valid, fixedFetcher(response))).toMatchObject({ outcome: 'success', text: 'Complete', partialOutput: false, finishReason: 'stop' });
  });

  it('rejects conflicting normal finish reasons', async () => {
    const result = await runWithTransport(valid, fixedFetcher(sse(chunk('Text', 'stop'), chunk('', 'length'), '[DONE]')));
    expect(result).toMatchObject({ outcome: 'interrupted', partialOutput: true, error: { kind: 'protocol' } });
  });

  it.each(['Partial', ''])('rejects an unexpected completion choice instead of certifying %j', async text => {
    const otherChoice = chunk('Ignored', 'stop', { choices: [{ index: 1, delta: { content: 'Ignored' }, finish_reason: 'stop' }] });
    const result = await runWithTransport(valid, fixedFetcher(sse(chunk(text), otherChoice, '[DONE]')));
    expect(result).toMatchObject({ outcome: text ? 'interrupted' : 'failed', text, partialOutput: Boolean(text), error: { kind: 'protocol' } });
  });

  it('rejects duplicate choice zero entries without silently dropping or combining alternatives', async () => {
    const duplicate = chunk('', 'stop', { choices: [
      { index: 0, delta: { content: 'Alternative A' }, finish_reason: 'stop' },
      { index: 0, delta: { content: 'Alternative B' }, finish_reason: 'stop' },
    ] });
    const result = await runWithTransport(valid, fixedFetcher(sse(chunk('Retained'), duplicate, '[DONE]')));
    expect(result).toMatchObject({ outcome: 'interrupted', text: 'Retained', partialOutput: true, error: { kind: 'protocol' } });
  });

  it.each([[200, 'text/html'], [201, 'text/event-stream'], [204, 'text/event-stream']] as const)('classifies unsupported HTTP %i %s as protocol, preserving observed status', async (status, contentType) => {
    const response = new Response(status === 204 ? null : 'Private unsupported response', { status, headers: { 'content-type': contentType } });
    const result = await runWithTransport(valid, fixedFetcher(response));
    expect(result).toMatchObject({ outcome: 'failed', httpStatus: status, error: { kind: 'protocol' } });
    expect(JSON.stringify(result)).not.toContain('Private unsupported response');
  });

  it('rejects tool-call deltas even when a normal-looking finish follows', async () => {
    const tool = chunk('', null, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'noop', arguments: '{}' } }] }, finish_reason: null }] });
    const result = await runWithTransport(valid, fixedFetcher(sse(tool, chunk('', 'stop'), '[DONE]')));
    expect(result).toMatchObject({ outcome: 'failed', error: { kind: 'protocol' } });
    if (result.outcome === 'failed') expect(result.error.message).toMatch(/tool calls/i);
  });

  it('lets an observable provider error override a provisional finish', async () => {
    expect(await runWithTransport(valid, fixedFetcher(sse(chunk('Complete-looking', 'stop'), chunk('', 'error', { error: { code: 502, message: 'Late error' } }))))).toMatchObject({ outcome: 'interrupted', partialOutput: true, finishReason: 'stop', error: { kind: 'provider' } });
  });

  it('preserves the triggering delta before a synchronous callback throws', async () => {
    const result = await runWithTransport({ ...valid, onText() { throw new Error('PRIVATE-CONSUMER-DETAIL'); } }, fixedFetcher(sse(chunk('Received before callback'))));
    expect(result).toMatchObject({ outcome: 'interrupted', text: 'Received before callback', partialOutput: true, error: { kind: 'consumer', phase: 'stream' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE-CONSUMER-DETAIL');
  });

  it('reports a network reset after preserving text', async () => {
    const fixture = controlledResponse();
    let first!: () => void;
    const received = new Promise<void>(resolve => { first = resolve; });
    const pending = runWithTransport({ ...valid, onText: () => { first(); } }, fixture.fetcher);
    await fixture.requested;
    fixture.emit(chunk('Partial'));
    await received;
    fixture.fail();
    expect(await pending).toMatchObject({ outcome: 'interrupted', text: 'Partial', error: { kind: 'network' } });
  });

  it('returns null HTTP status when a connection fails before a response', async () => {
    const result = await runWithTransport(valid, async () => { throw new TypeError('fetch failed'); });
    expect(result).toMatchObject({ outcome: 'failed', httpStatus: null, error: { kind: 'network', phase: 'request' } });
  });

  it('preserves fragmented UTF-8 and multiline SSE events through the SDK', async () => {
    const event = JSON.stringify(chunk('A🌍é', 'stop')).replace(',"object"', ',\ndata: "object"');
    const bytes = new TextEncoder().encode(`: comment\r\n\r\ndata: ${event}\n\ndata: [DONE]\n\n`);
    let index = 0;
    const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) { if (index < bytes.length) controller.enqueue(bytes.slice(index, ++index)); else controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    expect(await runWithTransport(valid, fixedFetcher(response))).toMatchObject({ outcome: 'success', text: 'A🌍é' });
  });
});

describe('validation and cancellation lifecycle', () => {
  it.each([
    { apiKey: '' }, { model: ' ' }, { prompt: '' }, { timeoutMs: 0 }, { timeoutMs: -1 },
    { timeoutMs: 2_147_483_648 }, { timeoutMs: NaN }, { maxTokens: 0 }, { maxTokens: 1.5 },
    { maxTokens: Infinity }, { onText: 'invalid' }, { signal: {} },
  ])('returns an input diagnostic before sending invalid input %j', async invalid => {
    const fetcher = vi.fn();
    const result = await runWithTransport({ ...valid, ...invalid } as unknown as LiveOptions, fetcher);
    expect(result).toMatchObject({ outcome: 'failed', error: { kind: 'input', phase: 'setup' }, httpStatus: null, partialOutput: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('prioritizes a pre-aborted caller signal without sending a request', async () => {
    const abort = new AbortController();
    abort.abort('private reason');
    const fetcher = vi.fn();
    expect(await runWithTransport({ ...valid, apiKey: '', signal: abort.signal }, fetcher)).toMatchObject({ outcome: 'cancelled', reason: 'caller', partialOutput: false, firstTokenMs: null, httpStatus: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['caller', 'timeout'] as const)('cleans up a pending request on %s', async cause => {
    vi.useFakeTimers();
    const abort = new AbortController();
    let requestStarted!: () => void;
    const started = new Promise<void>(resolve => { requestStarted = resolve; });
    let requestSignal!: AbortSignal;
    const fetcher = async (input: RequestInfo | URL) => {
      requestSignal = (input as Request).signal;
      requestStarted();
      return new Promise<Response>((_resolve, reject) => requestSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    };
    const pending = runWithTransport({ ...valid, signal: abort.signal, timeoutMs: 50 }, fetcher);
    await started;
    if (cause === 'caller') abort.abort(); else await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    expect(result.outcome).toBe(cause === 'caller' ? 'cancelled' : 'failed');
    if (cause === 'timeout' && result.outcome === 'failed') expect(result.error.kind).toBe('timeout');
    expect(requestSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['caller', 'timeout'] as const)('preserves text and releases a stalled reader on %s', async cause => {
    vi.useFakeTimers();
    const fixture = controlledResponse();
    const abort = new AbortController();
    const add = vi.spyOn(abort.signal, 'addEventListener');
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const pending = runWithTransport({ ...valid, signal: abort.signal, timeoutMs: 50 }, fixture.fetcher);
    const request = await fixture.requested;
    fixture.emit(chunk('Keep me'));
    await vi.advanceTimersByTimeAsync(0);
    if (cause === 'caller') abort.abort(); else await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    expect(result).toMatchObject({ outcome: cause === 'caller' ? 'cancelled' : 'interrupted', text: 'Keep me', partialOutput: true });
    expect(request.signal.aborted).toBe(true);
    expect(fixture.cancellations).toBe(1);
    expect(remove.mock.calls.filter(call => call[0] === 'abort')).toHaveLength(add.mock.calls.filter(call => call[0] === 'abort').length);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets a deadline win while draining after a finish reason', async () => {
    vi.useFakeTimers();
    const fixture = controlledResponse();
    const pending = runWithTransport({ ...valid, timeoutMs: 50 }, fixture.fetcher);
    await fixture.requested;
    fixture.emit(chunk('Looks done', 'stop'));
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toMatchObject({ outcome: 'interrupted', partialOutput: true, finishReason: 'stop', error: { kind: 'timeout' } });
  });

  it.each(['caller', 'timeout'] as const)('retains the first accepted %s terminal outcome', async first => {
    vi.useFakeTimers();
    const fixture = controlledResponse();
    const abort = new AbortController();
    const pending = runWithTransport({ ...valid, timeoutMs: 50, signal: abort.signal }, fixture.fetcher);
    await fixture.requested;
    if (first === 'caller') { abort.abort(); await vi.advanceTimersByTimeAsync(50); }
    else { await vi.advanceTimersByTimeAsync(50); abort.abort(); }
    fixture.emit(chunk('Late', 'stop'));
    fixture.end();
    const result = await pending;
    expect(result.outcome).toBe(first === 'caller' ? 'cancelled' : 'failed');
    if (first === 'timeout' && result.outcome === 'failed') expect(result.error.kind).toBe('timeout');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not replace accepted success with a later caller abort', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const result = await runWithTransport({ ...valid, signal: abort.signal }, fixedFetcher(sse(chunk('Done', 'stop'), '[DONE]')));
    abort.abort();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(result).toMatchObject({ outcome: 'success', text: 'Done', partialOutput: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});

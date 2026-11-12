import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSdk } from '../src/sdk.js';
import { chunk, fixedFetcher, sse } from './helpers.js';

const request = { chatRequest: { model: 'streamcheck/demo', messages: [{ role: 'user' as const, content: 'offline test' }], stream: true as const } };

afterEach(() => vi.unstubAllEnvs());

describe('pinned official SDK compatibility gate', () => {
  it('uses the injected HTTP client, exposes typed deltas, and observes the identical response', async () => {
    const response = sse(chunk('Hi'), chunk('', 'stop'), '[DONE]');
    let observed: Response | undefined;
    const sdk = createSdk('synthetic-key', fixedFetcher(response), value => { observed = value; });
    const stream = await sdk.chat.send(request);
    const chunks = [];
    for await (const value of stream) chunks.push(value);
    expect(observed).toBe(response);
    expect(observed?.status).toBe(200);
    expect(chunks.map(value => value.choices[0]?.delta.content)).toEqual(['Hi', '']);
    expect(chunks[1]?.choices[0]?.finishReason).toBe('stop');
  });

  it('does not retry retryable HTTP errors', async () => {
    let requests = 0;
    const sdk = createSdk('synthetic-key', async () => {
      requests++;
      return new Response(JSON.stringify({ error: { code: 503, message: 'Unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    });
    await expect(sdk.chat.send(request)).rejects.toBeDefined();
    expect(requests).toBe(1);
  });

  it('suppresses environment-triggered debug logging including authorization headers', async () => {
    vi.stubEnv('OPENROUTER_DEBUG', 'true');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const group = vi.spyOn(console, 'group').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sdk = createSdk('synthetic-key-never-log', fixedFetcher(sse(chunk('safe', 'stop'), '[DONE]')));
    for await (const _ of await sdk.chat.send(request)) { /* drain */ }
    expect(log).not.toHaveBeenCalled();
    expect(group).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('passes cancellation to an in-flight fetch', async () => {
    const abort = new AbortController();
    let received: AbortSignal | undefined;
    const sdk = createSdk('synthetic-key', async input => {
      const signal = (input as Request).signal;
      received = signal;
      return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    });
    const pending = sdk.chat.send(request, { signal: abort.signal });
    await vi.waitFor(() => expect(received).toBeDefined());
    abort.abort();
    await expect(pending).rejects.toBeDefined();
    expect(received?.aborted).toBe(true);
  });

  it('cancels the underlying body when a pending stream reader is cancelled', async () => {
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }), { headers: { 'content-type': 'text/event-stream' } });
    const sdk = createSdk('synthetic-key', fixedFetcher(response));
    const reader = (await sdk.chat.send(request)).getReader();
    const pending = reader.read();
    await reader.cancel();
    expect(await pending).toEqual({ done: true, value: undefined });
    reader.releaseLock();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('exposes valid provider errors but rejects string-valued error codes', async () => {
    const valid = createSdk('synthetic-key', fixedFetcher(sse(chunk('', 'error', { error: { code: 502, message: 'Provider failed' } }))));
    const reader = (await valid.chat.send(request)).getReader();
    expect((await reader.read()).value?.error?.code).toBe(502);
    await reader.cancel();
    reader.releaseLock();
    const rejected = createSdk('synthetic-key', fixedFetcher(sse(chunk('', 'error', { error: { code: 'server_error', message: 'Provider failed' } }))));
    const rejectedReader = (await rejected.chat.send(request)).getReader();
    await expect(rejectedReader.read()).rejects.toMatchObject({ name: 'ZodError' });
    rejectedReader.releaseLock();
  });

  it('hides DONE versus EOF and drops an unfinished trailing event', async () => {
    const wire = `data: ${JSON.stringify(chunk('Complete', 'stop'))}\n\ndata: {"error":`;
    const sdk = createSdk('synthetic-key', fixedFetcher(new Response(wire, { headers: { 'content-type': 'text/event-stream' } })));
    const values = [];
    for await (const value of await sdk.chat.send(request)) values.push(value);
    expect(values).toHaveLength(1);
    expect(values[0]?.choices[0]?.finishReason).toBe('stop');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithTransport } from '../src/runner.js';
import { chunk, controlledResponse, fixedFetcher } from './helpers.js';

const options = { apiKey: 'synthetic-key', model: 'streamcheck/demo', prompt: 'offline test', timeoutMs: 1000 };
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const response = (wire: string) => new Response(wire, { headers: { 'content-type': 'text/event-stream' } });

afterEach(() => vi.unstubAllGlobals());

describe('stream completion framing', () => {
  it.each(['', 'Complete'])('rejects EOF after a normal finish without DONE, retaining %j', async text => {
    const result = await runWithTransport(options, fixedFetcher(response(frame(chunk(text, 'stop')))));
    expect(result).toMatchObject({
      outcome: text ? 'interrupted' : 'failed', text, partialOutput: Boolean(text),
      httpStatus: 200, finishReason: 'stop', error: { kind: 'protocol', phase: 'stream' },
    });
    if (result.outcome === 'failed' || result.outcome === 'interrupted') expect(result.error.message).toContain('[DONE]');
  });

  it.each([
    ['partial JSON', 'data: {"error":'],
    ['JSON without a blank line', `data: ${JSON.stringify(chunk('', 'error', { error: { code: 502, message: 'PRIVATE-TRAILING-DETAIL' } }))}`],
    ['partial marker', 'data: [DON'],
    ['marker without a blank line', 'data: [DONE]\n'],
    ['partial field name', 'dat'],
  ])('rejects a truncated trailing frame containing %s', async (_label, tail) => {
    const result = await runWithTransport(options, fixedFetcher(response(frame(chunk('Retained', 'stop')) + tail)));
    expect(result).toMatchObject({
      outcome: 'interrupted', text: 'Retained', partialOutput: true, finishReason: 'stop',
      error: { kind: 'protocol', phase: 'stream' },
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE-TRAILING-DETAIL');
    if (result.outcome === 'interrupted') expect(result.error.message).toMatch(/unfinished.*frame/i);
  });

  it.each([
    ['text', frame(chunk('Literal [DONE] text', 'stop'))],
    ['comment', frame(chunk('Retained', 'stop')) + ': data: [DONE]\n\n'],
    ['ignored field', frame(chunk('Retained', 'stop')) + 'id: [DONE]\n\n'],
  ])('does not accept a DONE substring inside %s as a terminal event', async (_label, wire) => {
    expect(await runWithTransport(options, fixedFetcher(response(wire)))).toMatchObject({
      outcome: 'interrupted', partialOutput: true, finishReason: 'stop', error: { kind: 'protocol' },
    });
  });

  it.each(['\n', '\r\n', '\r'])('accepts a fragmented terminal event with %j line endings', async newline => {
    const text = 'A🌍 café';
    const wire = `\ufeff: heartbeat${newline}${newline}data: ${JSON.stringify(chunk(text, 'stop'))}${newline}${newline}event: message${newline}data:[DONE]${newline}${newline}`;
    const bytes = new TextEncoder().encode(wire);
    let offset = 0;
    const source = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset));
        else controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } });
    expect(await runWithTransport(options, fixedFetcher(source))).toMatchObject({
      outcome: 'success', text, partialOutput: false, finishReason: 'stop', warnings: [],
    });
  });

  it('observes the default fetch path as well as injected fetchers', async () => {
    vi.stubGlobal('fetch', fixedFetcher(response(frame(chunk('Retained', 'stop')))));
    expect(await runWithTransport(options)).toMatchObject({
      outcome: 'interrupted', text: 'Retained', error: { kind: 'protocol', phase: 'stream' },
    });
  });

  it('still requires a normal finish reason when DONE arrives', async () => {
    expect(await runWithTransport(options, fixedFetcher(response(frame(chunk('Partial')) + 'data: [DONE]\n\n')))).toMatchObject({
      outcome: 'interrupted', text: 'Partial', finishReason: null, error: { kind: 'protocol' },
    });
  });

  it('completes at DONE without waiting for HTTP EOF and releases the source reader', async () => {
    const fixture = controlledResponse();
    const pending = runWithTransport(options, fixture.fetcher);
    await fixture.requested;
    fixture.emit(chunk('Complete', 'stop'));
    fixture.raw('data: [DONE]\n\n');
    expect(await pending).toMatchObject({ outcome: 'success', text: 'Complete' });
    expect(fixture.cancellations).toBe(1);
    expect(fixture.response.body?.locked).toBe(false);
  });

  it('keeps a provider error ahead of missing-DONE diagnostics', async () => {
    const wire = frame(chunk('Retained', 'stop')) + frame(chunk('', 'error', { error: { code: 502, message: 'Synthetic failure' } }));
    expect(await runWithTransport(options, fixedFetcher(response(wire)))).toMatchObject({
      outcome: 'interrupted', text: 'Retained', error: { kind: 'provider', code: 502 },
    });
  });

  it('keeps a transport failure after a normal finish as a network diagnostic', async () => {
    const fixture = controlledResponse();
    let received!: () => void;
    const textReceived = new Promise<void>(resolve => { received = resolve; });
    const pending = runWithTransport({ ...options, onText: received }, fixture.fetcher);
    await fixture.requested;
    fixture.emit(chunk('Retained', 'stop'));
    await textReceived;
    fixture.fail();
    expect(await pending).toMatchObject({
      outcome: 'interrupted', text: 'Retained', finishReason: 'stop', error: { kind: 'network', phase: 'stream' },
    });
    expect(fixture.response.body?.locked).toBe(false);
  });

  it('releases the source reader after EOF with an unfinished frame', async () => {
    const source = response(frame(chunk('Retained', 'stop')) + 'data: [DON');
    expect(await runWithTransport(options, fixedFetcher(source))).toMatchObject({
      outcome: 'interrupted', text: 'Retained', error: { kind: 'protocol' },
    });
    expect(source.body?.locked).toBe(false);
  });
});

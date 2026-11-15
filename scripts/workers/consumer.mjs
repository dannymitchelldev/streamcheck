import assert from 'node:assert/strict';
import { runDemo, runStreamCheck } from 'streamcheck';

// This entire suite runs in workerd. Import only the installed public package.
const setup = { apiKey: 'synthetic', model: 'offline/model' };
const history = [
  { role: 'system', content: '  Keep whitespace.\n' },
  { role: 'user', content: 'Question 🌍' },
  { role: 'assistant', content: 'Earlier answer' },
  { role: 'user', content: 'Follow up' },
];
const chunk = (content = '', finish_reason = null, extra = {}) => ({
  id: 'gen-offline', object: 'chat.completion.chunk', created: 1, model: setup.model,
  choices: [{ index: 0, delta: { content }, finish_reason }], ...extra,
});
const frame = value => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
const response = wire => new Response(wire, { headers: { 'content-type': 'text/event-stream' } });
const sse = (...events) => response(events.map(frame).join(''));
const normal = () => sse(chunk('Hello ', null), chunk('🌍', 'stop'), '[DONE]');

function controlled() {
  let controller;
  let cancellations = 0;
  const body = new ReadableStream({
    start(value) { controller = value; },
    cancel() { cancellations++; },
  }, { highWaterMark: 0 });
  return {
    response: response(body),
    emit(value) { controller.enqueue(new TextEncoder().encode(frame(value))); },
    fail() { controller.error(new TypeError('Synthetic connection reset')); },
    get cancellations() { return cancellations; },
  };
}

export default {
  async test() {
    const passed = [];
    let totalRequests = 0;
    const pendingTimers = new Set();
    const startTimer = globalThis.setTimeout;
    const stopTimer = globalThis.clearTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => {
      const timer = startTimer(() => { pendingTimers.delete(timer); callback(...args); }, delay);
      pendingTimers.add(timer);
      return timer;
    };
    globalThis.clearTimeout = timer => { pendingTimers.delete(timer); stopTimer(timer); };
    async function check(name, {
      input = { messages: history }, makeResponse = normal, expected,
      expectedMessages = input.messages ?? [{ role: 'user', content: input.prompt }],
      afterText, requests: expectedRequests = 1, fixture, after,
    }) {
      let requests = 0;
      let received = '';
      let effectiveSignal;
      let transportFailure;
      const callerSignal = input.signal;
      let added = 0;
      let removed = 0;
      // Observe the runner's caller listener without changing its behavior.
      if (callerSignal) {
        const add = callerSignal.addEventListener.bind(callerSignal);
        const remove = callerSignal.removeEventListener.bind(callerSignal);
        callerSignal.addEventListener = (...args) => { if (args[0] === 'abort') added++; return add(...args); };
        callerSignal.removeEventListener = (...args) => { if (args[0] === 'abort') removed++; return remove(...args); };
      }
      globalThis.fetch = async (input, init) => {
        requests++;
        totalRequests++;
        try {
          assert.equal(requests, 1, 'Retries are forbidden');
          const request = input instanceof Request ? input : new Request(input, init);
          assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
          assert.equal(request.method, 'POST');
          assert.equal(request.headers.get('authorization'), 'Bearer synthetic');
          const body = await request.json();
          assert.deepEqual(body.messages, expectedMessages);
          assert.equal(body.model, setup.model);
          assert.equal(body.stream, true);
          assert.equal(body.max_tokens, 256);
          // RequestInit.signal overrides Request.signal in the pinned SDK.
          effectiveSignal = init?.signal ?? request.signal;
          assert(effectiveSignal instanceof AbortSignal);
          return await makeResponse(effectiveSignal);
        } catch (error) {
          if (error?.code === 'ERR_ASSERTION') transportFailure = error;
          throw error;
        }
      };
      const result = await runStreamCheck({
        ...setup, ...input,
        onText(delta) { received += delta; afterText?.(delta); },
      });
      // Transport assertion failures must not hide inside normalized diagnostics.
      assert.ifError(transportFailure);
      assert.equal(requests, expectedRequests, name);
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(result[key], value, `${name}: ${key}`);
      assert.equal(result.text, received, `${name}: accumulation before synchronous callback`);
      assert.equal(result.partialOutput, result.text.length > 0 && result.outcome !== 'success');
      assert.equal(result.schemaVersion, 1);
      assert.equal(result.source, 'live');
      assert(Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0);
      if (result.text) assert(Number.isFinite(result.firstTokenMs) && result.firstTokenMs >= 0 && result.firstTokenMs <= result.elapsedMs);
      else assert.equal(result.firstTokenMs, null);
      if (callerSignal) assert.equal(removed, added, `${name}: caller listener cleanup`);
      assert.equal(pendingTimers.size, 0, `${name}: deadline/retry timer cleanup`);
      if (fixture) {
        assert.equal(fixture.response.body.locked, false, `${name}: source reader released`);
        assert.equal(fixture.cancellations, 1, `${name}: upstream cancellation`);
      }
      after?.(result, effectiveSignal);
      passed.push(name);
    }

    const success = { outcome: 'success', text: 'Hello 🌍', finishReason: 'stop', httpStatus: 200, warnings: [] };
    await check('prompt compatibility', { input: { prompt: '  Legacy prompt\n' }, expected: success });
    await check('conversation roles/order/content', { expected: success });
    await check('normalized header', { input: { messages: history, apiKey: 'synthetic \r\n\t' }, expected: success });
    for (const [reason, warning] of [['length', 'token_limit'], ['content_filter', 'content_filter']]) {
      await check(`${reason} warning success`, { makeResponse: () => sse(chunk('Text', reason), '[DONE]'), expected: { outcome: 'success', text: 'Text', finishReason: reason, warnings: [warning] } });
    }
    await check('empty normal success', { makeResponse: () => sse(chunk('', 'stop'), '[DONE]'), expected: { outcome: 'success', text: '', finishReason: 'stop', warnings: [] } });
    for (const status of [401, 503]) {
      await check(`HTTP ${status} without retries`, {
        makeResponse: () => new Response(JSON.stringify({ error: { code: status, message: 'Synthetic failure' } }), { status, headers: { 'content-type': 'application/json' } }),
        expected: { outcome: 'failed', text: '', httpStatus: status, error: { kind: 'http', phase: 'request', message: `HTTP request failed (${status})` } },
      });
    }
    for (const text of ['', 'Retained']) {
      await check(`HTTP 200 provider error ${text ? 'after text' : 'before text'}`, {
        makeResponse: () => sse(chunk(text, text ? 'stop' : null), chunk('', 'error', { error: { code: 502, message: 'Private upstream detail' } })),
        expected: { outcome: text ? 'interrupted' : 'failed', text, httpStatus: 200, finishReason: text ? 'stop' : 'error', error: { kind: 'provider', phase: 'stream', code: 502, message: 'Provider error during streaming' } },
      });
    }
    for (const [name, wire, text, finishReason, message] of [
      ['missing finish', frame('[DONE]'), '', null, 'Stream ended without an observed normal finish reason'],
      ['missing DONE', frame(chunk('Retained', 'stop')), 'Retained', 'stop', 'Stream ended without an observed [DONE] event'],
      ['unfinished frame', frame(chunk('Retained', 'stop')) + 'data: {"error":', 'Retained', 'stop', 'Stream ended with an unfinished SSE frame'],
      ['malformed stream', frame(chunk('Retained', 'stop')) + frame('not-json'), 'Retained', 'stop', 'The SDK rejected a malformed or unsupported response'],
    ]) {
      await check(name, { makeResponse: () => response(wire), expected: { outcome: text ? 'interrupted' : 'failed', text, finishReason, error: { kind: 'protocol', phase: 'stream', message } } });
    }
    // Reset only after decoded text so a buffered failure cannot pass this case.
    const reset = controlled();
    reset.emit(chunk('Retained', 'stop'));
    await check('transport interruption after finish', {
      makeResponse: () => reset.response, afterText: () => reset.fail(),
      expected: { outcome: 'interrupted', text: 'Retained', finishReason: 'stop', error: { kind: 'network', phase: 'stream', message: 'Stream connection interrupted' } },
      after: () => assert.equal(reset.response.body.locked, false),
    });
    for (const action of ['throw', 'abort', 'abort-and-throw']) {
      const caller = new AbortController();
      const fixture = controlled();
      fixture.emit(chunk('Retained', 'stop'));
      await check(`callback ${action}`, {
        input: { messages: history, signal: caller.signal }, makeResponse: () => fixture.response, fixture,
        afterText() { if (action !== 'throw') caller.abort(); if (action !== 'abort') throw new Error('Private consumer detail'); },
        expected: { outcome: action === 'throw' ? 'interrupted' : 'cancelled', text: 'Retained', finishReason: 'stop', ...(action === 'throw' ? { error: { kind: 'consumer', phase: 'stream', message: 'The synchronous onText callback failed' } } : { reason: 'caller' }) },
        after: (_result, signal) => assert.equal(signal.aborted, true),
      });
    }
    const stalled = controlled();
    stalled.emit(chunk('Retained', 'stop'));
    await check('deadline while draining provisional finish', {
      input: { messages: history, timeoutMs: 100 }, makeResponse: () => stalled.response, fixture: stalled,
      expected: { outcome: 'interrupted', text: 'Retained', finishReason: 'stop', error: { kind: 'timeout', phase: 'stream', message: 'Overall streaming deadline exceeded' } },
      after: (_result, signal) => assert.equal(signal.aborted, true),
    });
    for (const cause of ['caller', 'timeout']) {
      const caller = new AbortController();
      await check(`pending request ${cause}`, {
        input: { messages: history, signal: caller.signal, timeoutMs: 100 },
        makeResponse: signal => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Synthetic abort', 'AbortError')), { once: true });
          if (cause === 'caller') caller.abort();
        }),
        expected: { outcome: cause === 'caller' ? 'cancelled' : 'failed', text: '', httpStatus: null, ...(cause === 'caller' ? { reason: 'caller' } : { error: { kind: 'timeout', phase: 'request', message: 'Overall streaming deadline exceeded' } }) },
        after(_result, signal) { assert.equal(signal.aborted, true); caller.abort(); },
      });
    }
    const later = new AbortController();
    await check('accepted success survives later abort', { input: { messages: history, signal: later.signal }, expected: success, after: result => { later.abort(); assert.equal(result.outcome, 'success'); } });

    const invalidInputs = [
      {}, { prompt: 'hello', messages: history }, { prompt: undefined, messages: history },
      { messages: [] }, { messages: null }, { messages: undefined }, { messages: 'hello' },
      { messages: [null] }, { messages: ['hello'] }, { messages: Array(1) },
      { messages: [{ role: 'tool', content: 'hello' }] }, { messages: [{ role: 'developer', content: 'hello' }] },
      { messages: [{ role: 'user', content: ' \n\t' }] }, { messages: [{ role: 'assistant', content: 42 }] },
      { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: 'synthetic' }] }] },
      { messages: [{ role: 'assistant', content: 'hello', tool_calls: [] }] },
    ];
    for (const [index, input] of invalidInputs.entries()) {
      await check(`invalid conversation ${index + 1}`, { input, requests: 0, expected: { outcome: 'failed', text: '', httpStatus: null }, after: result => { assert.equal(result.error.kind, 'input'); assert.equal(result.error.phase, 'setup'); } });
    }
    for (const [index, apiKey] of [undefined, '', ' ', 'synthetic\nkey', 'synthetic\rkey', 'synthetic\0key', 'synthetic\u0001key', 'synthetic\u000bkey', 'synthetic\u007fkey', 'synthetic\u0100key'].entries()) {
      await check(`invalid credential ${index + 1}`, { input: { messages: history, apiKey }, requests: 0, expected: { outcome: 'failed', text: '', httpStatus: null }, after: result => { assert.equal(result.error.kind, 'input'); assert.equal(result.error.phase, 'setup'); } });
    }
    const preAborted = new AbortController();
    preAborted.abort();
    await check('pre-aborted invalid input', { input: { apiKey: '', messages: [], signal: preAborted.signal }, requests: 0, expected: { outcome: 'cancelled', reason: 'caller', text: '', httpStatus: null } });
    const demo = await runDemo({ scenario: 'interrupted' });
    assert.equal(demo.outcome, 'interrupted');
    assert.equal(demo.text, 'Webhooks send HTTP notifications when an event');
    assert.equal(pendingTimers.size, 0, 'demo timer cleanup');
    passed.push('public demo compatibility');
    console.log('STREAMCHECK_REPORT=' + JSON.stringify({ passed, requests: totalRequests }));
  },
};

import { afterEach, expect, it, vi } from 'vitest';
import { runStreamCheck, type LiveOptions, type TextMessage } from '../src/index.js';
import { chunk, sse } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());
const setup = { apiKey: 'synthetic', model: 'offline/model' };
const messages = [
  { role: 'system', content: '  Keep whitespace.\n' },
  { role: 'user', content: 'First question 🌍' },
  { role: 'assistant', content: 'Earlier answer' },
  { role: 'user', content: 'Follow up' },
] as const satisfies readonly TextMessage[];

it('sends conversation roles, order, and exact content through the public API and real SDK', async () => {
  let body: unknown;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    body = await (input as Request).json();
    return sse(chunk('Answer', 'stop'), '[DONE]');
  });
  vi.stubGlobal('fetch', fetcher);
  const result = await runStreamCheck({ ...setup, messages });
  expect(result).toMatchObject({ outcome: 'success', text: 'Answer', finishReason: 'stop' });
  expect(body).toMatchObject({ messages, model: setup.model, stream: true, max_tokens: 256 });
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([
  {}, { prompt: 'hello', messages }, { prompt: undefined, messages },
  { messages: undefined }, { messages: null }, { messages: [] }, { messages: 'hello' },
  { messages: [null] }, { messages: ['hello'] }, { messages: [new Date()] },
  { messages: [{ role: 'tool', content: 'hello' }] },
  { messages: [{ role: 'developer', content: 'hello' }] },
  { messages: [{ role: 'user', content: '' }] },
  { messages: [{ role: 'assistant', content: ' \n\t' }] },
  { messages: [{ role: 'user', content: 42 }] },
  { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] },
  { messages: [{ role: 'assistant', content: 'hello', tool_calls: [] }] },
  { messages: [{ role: 'user', content: 'hello', images: [] }] },
  { messages: Array(1) },
])('rejects malformed or ambiguous conversation input before fetch: %j', async input => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await runStreamCheck({ ...setup, ...input } as unknown as LiveOptions)).toMatchObject({
    outcome: 'failed', text: '', partialOutput: false, httpStatus: null,
    error: { kind: 'input', phase: 'setup' },
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it('retains pre-aborted cancellation precedence over invalid conversation and credential input', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await runStreamCheck({ apiKey: '', model: '', messages: [], signal: controller.signal } as unknown as LiveOptions))
    .toMatchObject({ outcome: 'cancelled', reason: 'caller', text: '', httpStatus: null });
  expect(fetcher).not.toHaveBeenCalled();
});

// These are compiled by npm run typecheck, never executed as provider calls.
const promptOptions: LiveOptions = { ...setup, prompt: 'hello' };
const conversationOptions: LiveOptions = { ...setup, messages };
// @ts-expect-error Exactly one input is required.
const neither: LiveOptions = setup;
// @ts-expect-error Both input forms are forbidden.
const both: LiveOptions = { ...setup, prompt: 'hello', messages };
// @ts-expect-error A conversation must be nonempty.
const empty: LiveOptions = { ...setup, messages: [] };
// @ts-expect-error Only supported text roles are public.
const tool: TextMessage = { role: 'tool', content: 'hello' };
// @ts-expect-error Multimodal content is unsupported.
const image: TextMessage = { role: 'user', content: [{ type: 'image_url' }] };
void [promptOptions, conversationOptions, neither, both, empty, tool, image];

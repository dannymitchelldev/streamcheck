import { afterEach, expect, it, vi } from 'vitest';
import { runDemo, runStreamCheck } from '../src/index.js';
import type { DemoScenario } from '../src/index.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([
  ['success', 'success', false, 200],
  ['auth-failure', 'failed', false, 401],
  ['rate-limit', 'failed', false, 429],
  ['interrupted', 'interrupted', true, 200],
] as const)('runs the %s demo through the SDK without network', async (scenario, outcome, partialOutput, httpStatus) => {
  vi.useFakeTimers();
  vi.stubEnv('OPENROUTER_API_KEY', 'ambient-key-never-use');
  vi.stubEnv('OPENROUTER_BASE_URL', 'https://unexpected.invalid');
  const network = vi.fn(() => { throw new Error('Network forbidden'); });
  vi.stubGlobal('fetch', network);
  const pending = runDemo({ scenario });
  await vi.advanceTimersByTimeAsync(1_000);
  const result = await pending;
  expect(result).toMatchObject({ source: 'demo', outcome, partialOutput, httpStatus });
  expect(JSON.stringify(result)).not.toContain('ambient-key');
  expect(network).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('defaults to the interrupted scenario', async () => {
  vi.useFakeTimers();
  const pending = runDemo();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await pending).toMatchObject({ outcome: 'interrupted', text: 'Webhooks send HTTP notifications when an event', error: { kind: 'provider' } });
});

it('validates unknown demo names without network', async () => {
  expect(await runDemo({ scenario: 'invalid' as DemoScenario })).toMatchObject({ source: 'demo', outcome: 'failed', error: { kind: 'input', phase: 'setup' } });
});

it('cancels a demo before text and clears its fixture timers', async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const pending = runDemo({ signal: abort.signal });
  await vi.advanceTimersByTimeAsync(0);
  abort.abort();
  expect(await pending).toMatchObject({ outcome: 'cancelled', text: '', partialOutput: false });
  expect(vi.getTimerCount()).toBe(0);
});

it('validates live options through the public interface before touching the network', async () => {
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  expect(await runStreamCheck({ apiKey: '', model: '', prompt: '' })).toMatchObject({ source: 'live', outcome: 'failed', error: { kind: 'input' } });
  expect(network).not.toHaveBeenCalled();
});

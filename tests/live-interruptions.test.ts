import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { chunk } from './helpers.js';

const script = fileURLToPath(new URL('../scripts/live-interruptions.mjs', import.meta.url));
const guard = fileURLToPath(new URL('./offline-cli.mjs', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));

async function harness() {
  expect(existsSync(script), 'The manual interruption harness must exist').toBe(true);
  return import(pathToFileURL(script).href);
}

// Only the provider transport is synthetic. The harness, built runner, pinned
// SDK parser, native streams, abort handling, and exit mapping are real.
function fixture(mode: 'stalled' | 'complete' | 'buffered' | 'empty' | 'auth' = 'stalled') {
  let requests = 0;
  let cancellations = 0;
  const fetcher = async (input: RequestInfo | URL) => {
    requests++;
    expect(input).toBeInstanceOf(Request);
    expect((input as Request).url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((input as Request).method).toBe('POST');
    if (mode === 'auth') return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
    const event = mode === 'empty' ? '' : mode === 'buffered'
      ? `data: ${JSON.stringify(chunk('First'))}\n\ndata: ${JSON.stringify(chunk(' second', 'stop'))}\n\ndata: [DONE]\n\n`
      : `data: ${JSON.stringify(chunk('Live 🌍 café', mode === 'complete' ? 'stop' : null))}\n\n`;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        if (event) controller.enqueue(new TextEncoder().encode(event));
        if (mode !== 'stalled') controller.close();
      },
      cancel() { cancellations++; },
    }), { headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetcher, get requests() { return requests; }, get cancellations() { return cancellations; } };
}

it.each([
  ['cancel', 'cancelled', null, 130],
  ['transport', 'interrupted', 'network', 3],
  ['deadline', 'interrupted', 'timeout', 124],
] as const)('verifies %s after real SDK-decoded text and releases the upstream reader', async (scenario, outcome, kind, exit) => {
  const { runInterruptionCase } = await harness();
  const source = fixture();
  const report = await runInterruptionCase(scenario, {
    apiKey: 'synthetic-manual-key', model: 'example/model', timeoutMs: 100,
    fetcher: source.fetcher,
  });
  expect(report.verdict).toBe('passed');
  expect(report.result).toMatchObject({ outcome, text: 'Live 🌍 café', partialOutput: true, httpStatus: 200 });
  if (kind) expect(report.result.error).toMatchObject({ kind, phase: 'stream' });
  else expect(report.result.reason).toBe('caller');
  expect(report.cliExitCode).toBe(exit);
  expect(report.receivedText).toBe('Live 🌍 café');
  expect(report.injection.fired).toBe(true);
  expect(report.injection.textLengthAtTrigger).toBe('Live 🌍 café'.length);
  expect(report.upstreamReaderCancelled).toBe(true);
  expect(source.requests).toBe(1);
  expect(source.cancellations).toBe(1);
});

it('reports an empty completed stream as inconclusive instead of a passing fault check', async () => {
  const { runInterruptionCase } = await harness();
  const source = fixture('empty');
  const report = await runInterruptionCase('transport', {
    apiKey: 'synthetic-manual-key', model: 'example/model', timeoutMs: 100,
    fetcher: source.fetcher,
  });
  expect(report.verdict).toBe('inconclusive');
  expect(report.injection.fired).toBe(false);
  expect(report.result.text).toBe('');
  expect(source.requests).toBe(1);
});

it('records a pre-stream authentication failure without injecting or retrying', async () => {
  const { runInterruptionCase } = await harness();
  const source = fixture('auth');
  const report = await runInterruptionCase('cancel', {
    apiKey: 'synthetic-manual-key', model: 'example/model', timeoutMs: 100,
    fetcher: source.fetcher,
  });
  expect(report.verdict).toBe('failed');
  expect(report.result).toMatchObject({ outcome: 'failed', httpStatus: 401, error: { kind: 'http' } });
  expect(report.injection.fired).toBe(false);
  expect(source.requests).toBe(1);
});

it('marks a deadline experiment inconclusive when already-buffered completion wins', async () => {
  const { runInterruptionCase } = await harness();
  const source = fixture('buffered');
  const report = await runInterruptionCase('deadline', {
    apiKey: 'synthetic-manual-key', model: 'example/model', timeoutMs: 100,
    fetcher: source.fetcher,
  });
  expect(report.result).toMatchObject({ outcome: 'success', text: 'First second', finishReason: 'stop' });
  expect(report.injection.fired).toBe(true);
  expect(report.verdict).toBe('inconclusive');
  expect(report.checks.expectedOutcome).toBe(false);
  expect(source.requests).toBe(1);
});

it.each([
  { args: [], ci: '', status: 2, message: '--live' },
  { args: ['--live'], ci: 'true', status: 2, message: 'CI' },
  { args: ['--help'], ci: 'true', status: 0, message: 'Usage:' },
])('keeps the manual command network-free for $args / CI=$ci', async ({ args, ci, status, message }) => {
  await harness();
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(guard).href, script, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10_000,
    env: { ...process.env, CI: ci, OPENROUTER_API_KEY: 'synthetic-manual-key' },
  });
  expect(result.status, result.stderr).toBe(status);
  expect(result.stdout + result.stderr).toContain(message);
  expect(result.stdout + result.stderr).not.toContain('Provider network forbidden');
  expect(result.stdout + result.stderr).not.toContain('synthetic-manual-key');
});

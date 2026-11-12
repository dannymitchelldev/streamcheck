import { spawn, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { exitCodeFor } from '../src/cli.js';
import { inputFailure } from '../src/runner.js';

const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
function invoke(args: string[], envOverrides: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env: { ...process.env, OPENROUTER_API_KEY: 'synthetic-key-never-log', OPENROUTER_DEBUG: 'true', ...envOverrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    child.stdout.on('data', value => { out += value; });
    child.stderr.on('data', value => { err += value; });
    child.on('error', reject);
    child.on('close', code => { resolve({ code, out, err }); });
  });
}

it.each([
  ['success', 'success', 0, false],
  ['auth-failure', 'failed', 1, false],
  ['rate-limit', 'failed', 1, false],
  ['interrupted', 'interrupted', 3, true],
] as const)('JSON output and process exit agree for %s', async (scenario, outcome, code, partialOutput) => {
  const actual = await invoke(['demo', scenario, '--json']);
  expect(actual.code).toBe(code);
  expect(actual.err).toBe('');
  expect(JSON.parse(actual.out)).toMatchObject({ schemaVersion: 1, source: 'demo', outcome, partialOutput });
  expect(actual.out).not.toMatch(/synthetic-key|Authorization|\u001b/);
});

it('keeps human streamed text on stdout and its summary on stderr', async () => {
  const actual = await invoke(['demo', 'interrupted']);
  expect(actual.code).toBe(3);
  expect(actual.out).toBe('Webhooks send HTTP notifications when an event');
  expect(actual.err).toMatch(/Outcome:\s+Interrupted/);
  expect(actual.err).toMatch(/Partial output:\s+Preserved/);
  expect(actual.err).toMatch(/Failure:\s+Provider error during streaming/);
});

it.each([
  ['run', '--json'],
  ['run', '--model', '', '--prompt', 'hello', '--json'],
  ['demo', 'unknown', '--json'],
  ['demo', '--timeout', '0', '--json'],
  ['demo', '--timeout', 'bad', '--json'],
  ['demo', '--model', 'unwanted', '--json'],
  ['demo', '--wat', '--json'],
  ['unknown', '--json'],
])('maps every CLI input failure to JSON and exit 2: %j', async (...args) => {
  const actual = await invoke(args);
  expect(actual.code).toBe(2);
  expect(actual.err).toBe('');
  expect(JSON.parse(actual.out)).toMatchObject({ outcome: 'failed', error: { kind: 'input', phase: 'setup' } });
});

it('centrally maps library validation diagnostics to exit 2', () => {
  expect(exitCodeFor(inputFailure('Missing credentials', 'live'))).toBe(2);
});

it.each(['--timeout', '--model', '--prompt', '--max-tokens'])('preserves standalone JSON intent after a missing %s value', async option => {
  const actual = await invoke(['run', option, '--json']);
  expect(actual.code).toBe(2);
  expect(actual.err).toBe('');
  expect(JSON.parse(actual.out)).toMatchObject({ outcome: 'failed', error: { kind: 'input' } });
});

it.each([
  ['run', '--model', 'offline/model', '--prompt=--json'],
  ['demo', '--', '--json'],
])('respects literal JSON-looking values and the option terminator: %j', async (...args) => {
  const actual = await invoke(args, { OPENROUTER_API_KEY: '' });
  expect(actual.code).toBe(2);
  expect(actual.out).toBe('');
  expect(actual.err).toMatch(/Failure:/);
});

it('reports missing credentials as a JSON input diagnostic with exit 2', async () => {
  const actual = await invoke(['run', '--model', 'offline/model', '--prompt', 'hello', '--json'], { OPENROUTER_API_KEY: '' });
  expect(actual.code).toBe(2);
  expect(actual.err).toBe('');
  expect(JSON.parse(actual.out)).toMatchObject({ source: 'live', httpStatus: null, error: { kind: 'input', phase: 'setup' } });
});

it.each(['1', '150'])('uses timeout exit 124 with one JSON result at %s ms', async timeout => {
  const actual = await invoke(['demo', 'interrupted', '--timeout', timeout, '--json']);
  expect(actual.code).toBe(124);
  const result = JSON.parse(actual.out);
  expect(result.error.kind).toBe('timeout');
  expect(result.partialOutput).toBe(result.text.length > 0);
  expect(actual.err).toBe('');
});

it.each([[], ['--help'], ['run', '--help']])('prints help without requiring credentials: %j', async (...args) => {
  const actual = await invoke(args);
  expect(actual.code).toBe(0);
  expect(actual.out).toContain('streamcheck demo');
  expect(actual.out).toContain('--json');
  expect(actual.err).toBe('');
});

it('prints the package version', async () => {
  expect(await invoke(['--version'])).toEqual({ code: 0, out: '0.1.0\n', err: '' });
});

it.each([true, false])('maps the SIGINT handler to cancellation and exit 130 (json=%s)', async json => {
  const actual = await new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./interrupt-child.mjs', import.meta.url)), ['demo', 'interrupted', ...(json ? ['--json'] : [])], { silent: true });
    let out = ''; let err = ''; let interrupted = false;
    const interrupt = () => { if (!interrupted) { interrupted = true; child.send('interrupt'); } };
    child.on('message', message => { if (json && message === 'running') interrupt(); });
    child.stdout!.on('data', value => { out += value; if (!json) interrupt(); });
    child.stderr!.on('data', value => { err += value; });
    child.on('error', reject);
    child.on('close', code => { resolve({ code, out, err }); });
  });
  expect(actual.code).toBe(130);
  if (json) {
    expect(JSON.parse(actual.out)).toMatchObject({ outcome: 'cancelled', reason: 'caller', partialOutput: false });
    expect(actual.err).toBe('');
  } else {
    expect(actual.out.length).toBeGreaterThan(0);
    expect(actual.err).toMatch(/Outcome:\s+Cancelled/);
  }
});

it('does not install process signal handlers on library import', async () => {
  const count = process.listenerCount('SIGINT');
  await import('../src/index.js');
  expect(process.listenerCount('SIGINT')).toBe(count);
});

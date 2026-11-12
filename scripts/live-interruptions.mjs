import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { exitCodeFor } from '../dist/cli.js';
import { runWithTransport } from '../dist/runner.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const model = 'openai/gpt-4.1-nano';
const prompt = 'Write the numbers from 1 to 1000, one number per line. Continue until the output limit.';
const maxTokens = 128;
const timeoutMs = 30_000;
const expected = {
  cancel: { outcome: 'cancelled', kind: null, exit: 130 },
  transport: { outcome: 'interrupted', kind: 'network', exit: 3 },
  deadline: { outcome: 'interrupted', kind: 'timeout', exit: 124 },
};

/** A test-only response wrapper, forwarding native bytes without parsing SSE. */
export async function runInterruptionCase(scenario, options) {
  if (!Object.hasOwn(expected, scenario)) throw new Error('Unknown interruption scenario');
  const nativeFetch = options.fetcher ?? globalThis.fetch;
  const caller = new AbortController();
  const injection = { fired: false, textLengthAtTrigger: 0, elapsedMs: null };
  const started = performance.now();
  let receivedText = '';
  let textCallbacks = 0;
  let requestCount = 0;
  let observedStatus = null;
  let reader;
  let body;
  let closed = false;
  let frozen = false;
  let cancelPromise;
  let upstreamReaderCancelled = false;
  let detach = () => {};

  const cancelUpstream = () => {
    if (reader && !cancelPromise) {
      cancelPromise = reader.cancel().then(() => { upstreamReaderCancelled = true; }, () => {})
        .finally(() => { reader.releaseLock(); });
    }
    return cancelPromise;
  };
  const failBody = error => {
    if (!closed && body) { closed = true; body.error(error); }
    detach();
    void cancelUpstream();
  };
  const fetcher = async (input, init) => {
    // A second attempted request is stopped before native fetch, even if a
    // future SDK configuration accidentally re-enables retries.
    requestCount++;
    if (requestCount !== 1 || !(input instanceof Request) || input.method !== 'POST' || input.url !== 'https://openrouter.ai/api/v1/chat/completions') {
      throw new TypeError('Unexpected manual-check request');
    }
    const response = await nativeFetch(input, init);
    observedStatus = response.status;
    if (!response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) return response;
    reader = response.body.getReader();
    const onAbort = () => failBody(new DOMException('Manual check transport aborted', 'AbortError'));
    const wrapped = new ReadableStream({
      start(controller) { body = controller; },
      async pull(controller) {
        if (frozen || closed) return;
        try {
          const next = await reader.read();
          if (frozen || closed) return;
          if (next.done) { closed = true; detach(); controller.close(); }
          else controller.enqueue(next.value);
        } catch (error) { failBody(error); }
      },
      cancel() { closed = true; detach(); return cancelUpstream(); },
    }, { highWaterMark: 0 });
    input.signal.addEventListener('abort', onAbort, { once: true });
    detach = () => input.signal.removeEventListener('abort', onAbort);
    if (input.signal.aborted) onAbort();
    return new Response(wrapped, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  let result;
  try {
    result = await runWithTransport({
      apiKey: options.apiKey, model: options.model ?? model, prompt,
      maxTokens, timeoutMs: options.timeoutMs ?? timeoutMs, signal: caller.signal,
      onText(delta) {
        receivedText += delta;
        textCallbacks++;
        if (injection.fired || textCallbacks !== 1) return;
        // No fault can be claimed after the wrapped body has already ended.
        if (scenario !== 'cancel' && (closed || !body)) return;
        injection.fired = true;
        injection.textLengthAtTrigger = receivedText.length;
        injection.elapsedMs = performance.now() - started;
        if (scenario === 'cancel') caller.abort();
        else {
          frozen = true;
          if (scenario === 'transport') failBody(new TypeError('Locally injected transport read failure'));
          // For deadline, stop upstream work now, but hold the local body open
          // until the runner's existing overall deadline aborts its transport.
          else void cancelUpstream();
        }
      },
    }, fetcher);
  } finally {
    detach();
    await cancelUpstream();
  }
  const want = expected[scenario];
  const cliExitCode = exitCodeFor(result);
  const checks = {
    oneRequest: requestCount === 1,
    observedHttp200: observedStatus === 200 && result.httpStatus === 200,
    faultAfterText: injection.fired && injection.textLengthAtTrigger > 0,
    exactTextPreserved: receivedText.length > 0 && result.text === receivedText,
    partialOutput: result.partialOutput === true,
    expectedOutcome: result.outcome === want.outcome,
    expectedDiagnostic: want.kind === null ? result.reason === 'caller' && !result.error : result.error?.kind === want.kind && result.error.phase === 'stream',
    expectedCliExitMapping: cliExitCode === want.exit,
    timing: Number.isFinite(result.firstTokenMs) && result.firstTokenMs >= 0 && Number.isFinite(result.elapsedMs) && result.elapsedMs >= result.firstTokenMs,
    upstreamReaderCancelled,
    callerSignal: caller.signal.aborted === (scenario === 'cancel'),
  };
  // The SDK can already hold a complete terminal event when local delivery is
  // frozen. Preserve that success, but never count it as an interruption pass.
  const completionWon = scenario !== 'cancel' && result.outcome === 'success';
  const inconclusive = observedStatus === 200 && (!injection.fired || completionWon);
  const verdict = Object.values(checks).every(Boolean) ? 'passed' : inconclusive ? 'inconclusive' : 'failed';
  return {
    scenario, faultOrigin: 'local-test-harness', verdict, injection,
    requestCount, upstreamReaderCancelled, receivedText, textCallbacks,
    cliExitCode, result, checks,
  };
}

export async function main(args = process.argv.slice(2)) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: {
      live: { type: 'boolean' }, help: { type: 'boolean' }, 'env-file': { type: 'string' },
    }, strict: true, allowPositionals: false }));
  } catch { throw new Error('Invalid options; use --help'); }
  if (values.help) {
    console.log('Usage: npm run test:live:interruptions -- --live [--env-file=path]\nRuns three potentially billable requests, sequentially, outside CI.\nThe command exits 0 only when all cases pass; per-case CLI codes are mapped, not subprocess exits.');
    return 0;
  }
  if (!values.live) throw new Error('Explicit --live is required; no requests sent');
  if (process.env.CI) throw new Error('Live interruption checks are disabled when CI is set; no requests sent');
  if (values['env-file']) {
    try { loadEnvFile(values['env-file']); }
    catch { throw new Error('Could not load the requested environment file; no requests sent'); }
  }
  if (process.env.CI) throw new Error('Live interruption checks are disabled when CI is set; no requests sent');
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey?.trim()) throw new Error('OPENROUTER_API_KEY is required; no requests sent');

  const hash = value => createHash('sha256').update(value).digest('hex');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const report = {
    evidenceVersion: 1, kind: 'live-stream-with-locally-injected-faults',
    startedAtUtc: new Date().toISOString(), completedAtUtc: null,
    commit: git(['rev-parse', 'HEAD']), trackedDiffSha256: hash(git(['diff', 'HEAD'])),
    runtime: {
      nodeVersion: process.version, platform: process.platform,
      harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
      packageVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
      sdkVersion: JSON.parse(readFileSync(join(root, 'node_modules/@openrouter/sdk/package.json'), 'utf8')).version,
      builtFileSha256: Object.fromEntries(['runner', 'sdk', 'cli', 'index'].map(name => [name, hash(readFileSync(join(root, `dist/${name}.js`)))])),
    },
    request: { model, prompt, maxTokens, timeoutMs, automaticRetries: false },
    cliExitEvidence: 'Shared production exit mapper only; production CLI subprocess and physical Ctrl+C are not exercised.',
    scope: 'Genuine live text with deliberate local faults; not natural upstream provider failures or proof that billing stopped.',
    cases: [], verdict: 'incomplete',
  };
  const base = join(root, '.work/live-interruptions');
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, new Date().toISOString().replace(/[:.]/g, '-') + '-'));
  const target = join(directory, 'receipt.json');
  const save = () => {
    const content = JSON.stringify(report, null, 2) + '\n';
    if (content.includes(apiKey)) throw new Error('Credential-disclosure guard failed; output withheld');
    writeFileSync(target, content);
  };
  save();
  console.log('Running three bounded live interruption checks (128 output tokens / 30000 ms per request).');
  for (const scenario of Object.keys(expected)) {
    const item = await runInterruptionCase(scenario, { apiKey });
    report.cases.push(item);
    save();
    console.log(`${scenario}: ${item.verdict.toUpperCase()} (outcome=${item.result.outcome}, mapped CLI exit=${item.cliExitCode})`);
  }
  report.completedAtUtc = new Date().toISOString();
  report.verdict = report.cases.every(item => item.verdict === 'passed') ? 'passed' : 'failed';
  save();
  console.log(`Evidence: ${target}`);
  return report.verdict === 'passed' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) {
    // Setup messages are authored above; raw SDK/transport errors never escape.
    const safe = error instanceof Error && /^(Invalid options|Explicit --live|Live interruption checks|Could not load|OPENROUTER_API_KEY|Credential-disclosure)/.test(error.message);
    console.error(safe ? error.message : 'Manual interruption check failed; raw exception withheld. Inspect any saved receipt.');
    process.exitCode = 2;
  }
}

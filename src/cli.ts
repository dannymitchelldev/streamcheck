import { parseArgs } from 'node:util';
import { runDemo, runStreamCheck } from './index.js';
import { inputFailure } from './runner.js';
import type { DemoScenario, RunResult, RunSource, WarningCode } from './types.js';

const HELP = `StreamCheck — diagnose one OpenRouter text stream

Usage:
  streamcheck run --model <model-id> --prompt <text> [options]
  streamcheck demo [success|auth-failure|rate-limit|interrupted] [options]

Options:
  --json              Emit one complete JSON result, without streamed fragments
  --timeout <ms>      Overall deadline (default: 30000)
  --max-tokens <n>    Maximum output tokens for run (default: 256)
  --help, -h         Show this help
  --version, -v      Show version

run explicitly uses OPENROUTER_API_KEY and can incur charges.
demo defaults to interrupted, uses synthetic fixtures, and requires no credentials.
Exit: success 0; failure 1; input 2; interrupted 3; timeout 124; Ctrl+C 130.
`;

const options = {
  model: { type: 'string' }, prompt: { type: 'string' }, timeout: { type: 'string' },
  'max-tokens': { type: 'string' }, json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
} as const;

/** The only exit mapping, shared by CLI parsing and library validation results. */
export function exitCodeFor(result: RunResult): number {
  if (result.outcome === 'success') return 0;
  if (result.outcome === 'cancelled') return 130;
  if (result.error.kind === 'input') return 2;
  if (result.error.kind === 'timeout') return 124;
  return result.outcome === 'interrupted' ? 3 : 1;
}

const warningText: Record<WarningCode, string> = {
  token_limit: 'Token limit reached; delivered text may be truncated',
  content_filter: 'Content filtering limited the response',
};
const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

function summary(result: RunResult): string {
  const rows: [string, string][] = [
    ['Outcome:', result.outcome[0]!.toUpperCase() + result.outcome.slice(1)],
    ['First token:', result.firstTokenMs === null ? 'n/a' : duration(result.firstTokenMs)],
    ['Elapsed:', duration(result.elapsedMs)],
    ['Partial output:', result.partialOutput ? 'Preserved' : 'None'],
    ['HTTP status:', result.httpStatus === null ? 'Unavailable' : String(result.httpStatus)],
  ];
  if (result.outcome === 'failed' || result.outcome === 'interrupted') {
    let failure = result.error.message;
    if (result.error.kind === 'http' && result.httpStatus === 401) failure = 'Authentication failed (HTTP 401)';
    if (result.error.kind === 'http' && result.httpStatus === 429) failure = 'Rate limited (HTTP 429)';
    rows.push(['Failure:', failure]);
  }
  if (result.outcome === 'cancelled') rows.push(['Reason:', 'Caller cancellation']);
  for (const warning of result.warnings) rows.push(['Warning:', warningText[warning]]);
  return `${result.text && !result.text.endsWith('\n') ? '\n\n' : ''}${result.source === 'demo' ? '[Offline demo]\n' : ''}${rows.map(([label, value]) => `${label.padEnd(17)}${value}`).join('\n')}\n`;
}

function write(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => { stream.write(text, error => { if (error) reject(error); else resolve(); }); });
}

/** Internal CLI entry; importing the library never installs process handlers. */
export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  let json = false;
  let source: RunSource | null = null;
  let model: string | null = null;
  let outputFailed = false;
  const abort = new AbortController();
  const onInterrupt = () => { abort.abort(); };
  const onOutputError = () => { outputFailed = true; abort.abort(); };
  process.stdout.on('error', onOutputError);
  process.stderr.on('error', onOutputError);
  const render = async (result: RunResult) => {
    if (outputFailed) return 1;
    if (json) await write(process.stdout, `${JSON.stringify(result)}\n`);
    else { await write(process.stdout, ''); await write(process.stderr, summary(result)); }
    return outputFailed ? 1 : exitCodeFor(result);
  };
  const invalid = (message: string) => render(inputFailure(message, source, model));
  try {
    // A missing string value can swallow --json in permissive parsing. Recover
    // the standalone flag before --, while preserving --prompt=--json literals.
    const terminator = args.indexOf('--');
    json = args.slice(0, terminator < 0 ? args.length : terminator).includes('--json');
    const preview = parseArgs({ args, options, allowPositionals: true, strict: false });
    const command = preview.positionals[0];
    source = command === 'run' ? 'live' : command === 'demo' ? 'demo' : null;
    model = typeof preview.values.model === 'string' ? preview.values.model : null;
    let parsed;
    try { parsed = parseArgs({ args, options, allowPositionals: true, strict: true }); }
    catch { return await invalid('Invalid command options; see --help'); }
    const { values, positionals } = parsed;
    if (json && (values.help || values.version || !command)) return await invalid('--json requires a run or demo command');
    if (values.help || args.length === 0) { await write(process.stdout, HELP); return 0; }
    if (values.version) { await write(process.stdout, '0.1.0\n'); return 0; }
    if (command !== 'run' && command !== 'demo') return await invalid('Choose run or demo; see --help');
    if (positionals.length > (command === 'run' ? 1 : 2)) return await invalid('Unexpected positional arguments; see --help');
    if (command === 'demo' && (values.model !== undefined || values.prompt !== undefined || values['max-tokens'] !== undefined)) return await invalid('--model, --prompt, and --max-tokens apply only to run');
    process.on('SIGINT', onInterrupt);
    const common = {
      signal: abort.signal,
      ...(values.timeout !== undefined ? { timeoutMs: Number(values.timeout) } : {}),
      ...(!json ? { onText: (delta: string) => { process.stdout.write(delta); } } : {}),
    };
    const result = command === 'demo'
      ? await runDemo({ ...common, ...(positionals[1] !== undefined ? { scenario: positionals[1] as DemoScenario } : {}) })
      : await runStreamCheck({
        ...common, apiKey: process.env['OPENROUTER_API_KEY'] ?? '', model: values.model ?? '', prompt: values.prompt ?? '',
        ...(values['max-tokens'] !== undefined ? { maxTokens: Number(values['max-tokens']) } : {}),
      });
    return await render(result);
  } catch {
    if (outputFailed) return 1;
    const base = inputFailure('', source, model);
    try { return await render({ ...base, error: { kind: 'internal', phase: 'setup', message: 'An unexpected CLI error occurred' } }); }
    catch { return 1; }
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.stdout.removeListener('error', onOutputError);
    process.stderr.removeListener('error', onOutputError);
  }
}

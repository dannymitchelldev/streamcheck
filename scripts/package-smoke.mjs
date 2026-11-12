import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run through npm run test:package');
assert(process.argv.length <= 3, 'Usage: npm run test:package -- [artifact.tgz]');
const supplied = process.argv[2] ? resolve(process.argv[2]) : null;
if (supplied) assert(existsSync(supplied) && statSync(supplied).isFile(), 'Release artifact does not exist');
const temporary = mkdtempSync(join(tmpdir(), 'streamcheck-consumer-'));

function run(executable, args, cwd, expected = 0) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');

try {
  const tarball = supplied ?? join(temporary, JSON.parse(run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', temporary], root))[0].filename);
  const before = digest(tarball);
  const entries = run('tar', ['-tzf', tarball], temporary).trim().split(/\r?\n/);
  for (const entry of entries) {
    assert(!entry.split('/').some(part => part === '..' || part.startsWith('.')), `Unexpected archive path: ${entry}`);
    assert(/^package\/(?:dist\/|src\/|docs\/|package\.json$|README\.md$|CHANGELOG\.md$|CONTRIBUTING\.md$|LICENSE$)/.test(entry), `Unapproved archive path: ${entry}`);
  }
  for (const required of ['dist/index.js', 'dist/index.d.ts', 'dist/bin.js', 'src/index.ts', 'package.json', 'README.md', 'LICENSE', 'docs/demo.gif', 'docs/demo.cast']) {
    assert(entries.includes(`package/${required}`), `Missing package file: ${required}`);
  }
  const member = name => run('tar', ['-xOzf', tarball, name], temporary);
  const bin = member('package/dist/bin.js');
  assert(bin.startsWith('#!/usr/bin/env node\n') && !bin.includes('\r'), 'Packed bin must have an LF-only shebang');
  for (const file of entries.filter(entry => entry.endsWith('.map'))) {
    const map = JSON.parse(member(file));
    assert(map.sourceRoot === '' || map.sourceRoot === undefined, 'Source-map root must be empty');
    for (const source of map.sources) {
      assert(!posix.isAbsolute(source) && !win32.isAbsolute(source) && !source.includes('://'), 'Source-map paths must be relative');
      assert(entries.includes(posix.normalize(posix.join(posix.dirname(file), source))), 'Source-map source must ship in the archive');
    }
  }
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ name: 'streamcheck-consumer-smoke', private: true, type: 'module' }));
  // Dependency installation may use npm. Provider execution below stays offline.
  // npm ci alone does not populate the registry metadata required by --offline.
  run(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], temporary);
  const installed = JSON.parse(readFileSync(join(temporary, 'node_modules/streamcheck/package.json'), 'utf8'));
  assert.equal(installed.version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  assert.equal(installed.license, 'MIT');
  assert.equal(installed.bin.streamcheck, './dist/bin.js');

  writeFileSync(join(temporary, 'consumer.mjs'), `
import assert from 'node:assert/strict';
globalThis.fetch = () => { throw new Error('Provider network forbidden'); };
const { runDemo, runStreamCheck } = await import('streamcheck');
assert.equal(typeof runStreamCheck, 'function');
const result = await runDemo({scenario:'interrupted'});
assert.equal(result.outcome, 'interrupted');
assert.equal(result.partialOutput, true);
assert.equal(result.text, 'Webhooks send HTTP notifications when an event');
`);
  run(process.execPath, ['consumer.mjs'], temporary);
  writeFileSync(join(temporary, 'consumer.ts'), `
import {runDemo, runStreamCheck, type RunResult, type LiveOptions, type DemoScenario} from 'streamcheck';
const options: LiveOptions = {apiKey:'synthetic', model:'example/model', prompt:'example', onText(delta) { delta.toUpperCase(); }};
const live: Promise<RunResult> = runStreamCheck(options);
const result: RunResult = await runDemo({scenario:'interrupted'});
const first: number | null = result.firstTokenMs;
if(result.outcome === 'failed' || result.outcome === 'interrupted') { result.error.kind; }
if(result.outcome === 'cancelled') { const reason: 'caller' = result.reason; }
// @ts-expect-error Invalid scenarios must remain a type error.
const invalid: DemoScenario = 'invented';
void live; void first; void invalid;
`);
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2023', '--skipLibCheck', 'consumer.ts'], temporary);
  const cli = JSON.parse(run(process.execPath, [npmCli, 'exec', '--offline', '--', 'streamcheck', 'demo', 'interrupted', '--json'], temporary, 3));
  assert.equal(cli.outcome, 'interrupted');
  assert.equal(cli.partialOutput, true);
  assert.equal(digest(tarball), before, 'Consumer verification must not modify the artifact');
  console.log(`Package consumer: archive, ESM, declarations, and installed CLI passed (${basename(tarball)}).`);
} finally {
  // Verify this computed recursive-delete target belongs to our one temp allocation.
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert(basename(temporary).startsWith('streamcheck-consumer-'));
  rmSync(temporary, { recursive: true, force: true });
}

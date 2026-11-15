import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import workerd from 'workerd';

const root = fileURLToPath(new URL('..', import.meta.url));
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run through npm run test:workers');
assert(process.argv.length <= 3, 'Usage: npm run test:workers -- [artifact.tgz]');
const supplied = process.argv[2] ? resolve(process.argv[2]) : null;
if (supplied) assert(existsSync(supplied) && statSync(supplied).isFile(), 'Candidate artifact does not exist');
const temporary = mkdtempSync(join(tmpdir(), 'streamcheck-workers-'));
const compatibilityDate = '2026-07-30';
const compatibilityFlags = ['nodejs_compat'];
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function run(args, cwd = temporary) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

try {
  const tarball = supplied ?? join(temporary, JSON.parse(run([npmCli, 'pack', '--json', '--pack-destination', temporary], root))[0].filename);
  const sha256 = digest(tarball);
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ name: 'streamcheck-workers-consumer', private: true, type: 'module' }));
  // Only installation uses npm/network. No source aliases or internal package imports.
  run([npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  const bundle = await build({
    stdin: { contents: readFileSync(new URL('./workers/consumer.mjs', import.meta.url), 'utf8'), resolveDir: temporary, sourcefile: 'consumer-worker.mjs' },
    absWorkingDir: temporary, bundle: true, write: false, metafile: true,
    format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'],
    mainFields: ['module', 'main'], external: ['node:*'], target: 'es2023',
  });
  assert(Object.keys(bundle.metafile.inputs).some(file => file.replaceAll('\\', '/').endsWith('node_modules/streamcheck/dist/index.js')), 'Must bundle installed public ESM export');
  writeFileSync(join(temporary, 'consumer.mjs'), bundle.outputFiles[0].text);
  writeFileSync(join(temporary, 'config.capnp'), readFileSync(new URL('./workers/config.capnp', import.meta.url)));
  const executed = spawnSync(workerd.default, ['test', 'config.capnp', 'streamcheck'], {
    cwd: temporary, encoding: 'utf8', timeout: 60_000, windowsHide: true,
  });
  assert.ifError(executed.error);
  assert.equal(executed.status, 0, `${executed.stdout}\n${executed.stderr}`);
  const output = `${executed.stdout}\n${executed.stderr}`;
  const externalRequests = output.split('STREAMCHECK_FORBIDDEN_EGRESS').length - 1;
  assert.equal(externalRequests, 0, 'Unexpected runtime egress attempt');
  const report = JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('STREAMCHECK_REPORT='))?.slice('STREAMCHECK_REPORT='.length) ?? 'null');
  assert(report?.passed?.length, `Missing workerd acceptance report: ${output}`);
  assert.equal(digest(tarball), sha256, 'Verification must not modify the archive');
  const installed = JSON.parse(readFileSync(join(temporary, 'node_modules/streamcheck/package.json'), 'utf8'));
  const version = name => JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  const sdk = JSON.parse(readFileSync(join(temporary, 'node_modules/@openrouter/sdk/package.json'), 'utf8')).version;
  console.log(JSON.stringify({ package: `streamcheck@${installed.version}`, sdk, workerd: version('workerd'), esbuild: version('esbuild'), node: process.version, compatibilityDate, compatibilityFlags, sha256, externalRequests, ...report }, null, 2));
} finally {
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert(basename(temporary).startsWith('streamcheck-workers-'));
  rmSync(temporary, { recursive: true, force: true });
}

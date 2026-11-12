import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const args = process.argv.slice(2);
if (args[0] === '--check') {
  assert.equal(args.length, 2, 'Usage: checksum.mjs --check SHA256SUMS');
  const manifest = resolve(args[1]);
  const entry = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)\n$/.exec(readFileSync(manifest, 'utf8'));
  assert(entry, 'Expected one filename-bearing LF checksum without a BOM');
  assert.equal(digest(join(dirname(manifest), entry[2])), entry[1], 'Artifact checksum mismatch');
  console.log(`${entry[2]}: OK`);
} else {
  assert.equal(args.length, 1, 'Usage: checksum.mjs <artifact.tgz>');
  const artifact = resolve(args[0]);
  const name = basename(artifact);
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name), 'Artifact basename must be portable');
  writeFileSync(join(dirname(artifact), 'SHA256SUMS'), `${digest(artifact)}  ${name}\n`, 'utf8');
  console.log(`Wrote SHA256SUMS for ${name}`);
}

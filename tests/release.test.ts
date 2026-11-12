import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const checksum = join(root, 'scripts/checksum.mjs');

it('does not silently repack when an explicit release artifact is missing', () => {
  const missing = join(tmpdir(), 'streamcheck-definitely-missing-release-artifact.tgz');
  const result = spawnSync(process.execPath, [join(root, 'scripts/package-smoke.mjs'), missing], { cwd: root, encoding: 'utf8', timeout: 25_000, windowsHide: true });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Release artifact does not exist');
}, 30_000);

it('generates a filename-bearing LF checksum and detects changed artifact bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'streamcheck-release-test-'));
  try {
    const artifact = join(directory, 'checksum-fixture.tgz');
    writeFileSync(artifact, 'abc');
    const generated = spawnSync(process.execPath, [checksum, artifact], { encoding: 'utf8', windowsHide: true });
    expect(generated.status, generated.stderr).toBe(0);
    const manifest = join(directory, 'SHA256SUMS');
    expect(readFileSync(manifest, 'utf8')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  checksum-fixture.tgz\n');
    const verified = spawnSync(process.execPath, [checksum, '--check', manifest], { encoding: 'utf8', windowsHide: true });
    expect(verified.status, verified.stderr).toBe(0);
    if (process.platform === 'linux') {
      const gnu = spawnSync('sha256sum', ['--check', 'SHA256SUMS'], { cwd: directory, encoding: 'utf8' });
      expect(gnu.status, gnu.stderr).toBe(0);
    }
    writeFileSync(artifact, 'changed');
    expect(spawnSync(process.execPath, [checksum, '--check', manifest], { encoding: 'utf8', windowsHide: true }).status).not.toBe(0);
  } finally {
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    expect(basename(directory).startsWith('streamcheck-release-test-')).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

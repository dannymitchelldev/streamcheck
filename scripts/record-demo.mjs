import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Capture the actual offline CLI. No invented output, timing, or provider calls.
const root = fileURLToPath(new URL('..', import.meta.url));
const started = performance.now();
const events = [];
const child = spawn(process.execPath, ['dist/bin.js', 'demo', 'interrupted'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', text => { events.push([(performance.now() - started) / 1000, 'o', text.replace(/\r?\n/g, '\r\n')]); });
}
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
assert.equal(code, 3, 'The recording must demonstrate an actual interrupted result');
const header = { version: 2, width: 88, height: 18, timestamp: Math.floor(Date.now() / 1000), title: 'StreamCheck offline interrupted stream', env: { TERM: 'xterm-256color' } };
writeFileSync(new URL('../docs/demo.cast', import.meta.url), [JSON.stringify(header), ...events.map(event => JSON.stringify(event))].join('\n') + '\n');
console.log(`Recorded offline CLI: ${events.length} output events, actual exit ${code}.`);

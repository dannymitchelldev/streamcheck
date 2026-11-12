# Testing runbook

## Offline verification

Local baseline verified 2026-11-11: Windows / Node 24.18.0, 93 tests. Publication verification on 2026-11-12 passed types, build, **95 tests**, and the archive/fresh-consumer check using a newly populated npm cache (npm 11.16.0). The linked CI and release notes establish exact-commit cross-platform results.

SDK gate 7/7, core suite, build, and typed examples passed at the baseline. [Current CI results](https://github.com/dannymitchelldev/streamcheck/actions/workflows/ci.yml?query=branch%3Amain) establish the Windows/Ubuntu and Node 22.12.0/24 evidence for each commit; release notes link the exact validated run.

### Purpose

Verify the library, SDK boundary, CLI, and packed consumer without provider credentials or LLM requests.

### Setup / Seed Data

- Node.js 22.12+, npm, and the standard tar command for package verification.
- Tests use synthetic credentials and in-process HTTP/SSE fixtures. No services or API key required. Dependency installation may contact the npm registry.

### Safe Actions

- `npm run test:sdk`: executable pinned-SDK compatibility gate.
- `npm run check`: type checking, built CLI/library tests, and a local packed-package consumer.
- `node dist/bin.js demo interrupted`: expected exit **3**, with retained partial text.

### Destructive / Mutating Actions

- npm ci downloads packages and writes node_modules/caches; it does not update the lockfile. Dependency changes require an intentional lockfile update.
- Builds and checks write ignored dist/.work artifacts and a temporary consumer, removed afterward.
- `run` and `example:live` make real provider requests; they are not part of offline verification.

### Steps

1. Install dependencies.
2. Pass the pinned-SDK compatibility gate.
3. Run `npm run check`.
4. Exercise the interrupted demo in human and JSON modes.

### Verification Commands

```sh
npm run test:sdk
npm run check
node dist/bin.js demo interrupted --json
```

Expected: gate and check exit 0; interrupted JSON is one result with outcome interrupted, partialOutput true, and exit 3.

### Cleanup

Tests release timers/readers/listeners. The package-consumer check removes only its own temporary directory. Generated build and scratch artifacts are ignored.

### Troubleshooting Notes

- Do not interpret the demo's exit 3 as a broken installation.
- Report actual platform/version checks separately from authored CI jobs.
- CLI subprocess cases intentionally pay the SDK's cold import cost; the final 93-test suite took 54.60 seconds locally. Do not replace subprocess checks with assertions on a fake CLI.
- SIGINT tests use an IPC harness to emit the Node process event portably, including after partial text. This establishes handler behavior, not physical Windows console Ctrl+C behavior.
- Tests exercise SDK-observable EOF semantics; no test can establish that the hidden [DONE] marker or a discarded partial frame was received.
- When changing argument parsing, cover missing option values before standalone --json, literal --prompt=--json, and the -- terminator. Strict and permissive Node argument parsing interpret missing values differently.
- SDK fixtures must not let another choice's finish certify choice zero. Unexpected/duplicate choice entries are protocol failures; already retained text must survive.
- A cold npm cache exposed an old ENOTCACHED failure: npm ci cached package files without all registry manifests needed by a separate --offline install. Consumer dependency installation now permits npm access. Runtime provider access remains blocked, and installed CLI resolution remains offline.

## Release artifact verification

### Purpose

Verify the exact archive that will be uploaded, without silently repacking different bytes.

### Setup / Seed Data

Use a clean checkout of the intended release commit. Create the artifact directory outside that checkout's tracked files. Build before packing. A package install may use npm; no provider credentials are needed.

### Safe Actions

Archive inspection, isolated-consumer execution, and checksum verification do not call providers. The consumer checks ESM exports, TypeScript declarations, CLI JSON/exit 3, relative source-map sources, LF shebang, license, and archive allowlist.

### Destructive / Mutating Actions

Packing writes the archive; checksum generation writes SHA256SUMS beside it. The smoke test creates and removes only its own temporary consumer. Publication is a separate explicit release action.

### Steps

1. Build and npm pack from the clean release checkout, recording its commit.
2. Pass that exact .tgz path to the consumer check.
3. Generate and verify SHA256SUMS using Node. Format: lowercase SHA-256, two spaces, portable basename, LF, no BOM.
4. Upload those bytes after all four CI jobs pass at the release commit.
5. Download both assets anonymously, verify the checksum, and repeat the exact-artifact consumer check.

### Verification Commands

```sh
npm run test:package -- <path-to-streamcheck-0.1.0.tgz>
npm run checksum -- <path-to-streamcheck-0.1.0.tgz>
npm run checksum -- --check <path-to-SHA256SUMS>
```

Default npm run test:package packs a new candidate for CI. Supplying a missing path must fail; supplying a valid archive must never repack or alter it. GNU verification is also available with sha256sum -c SHA256SUMS; shasum -a 256 -c SHA256SUMS is an alternative when installed.

For a cold-cache reproduction, run npm ci and npm run check with the same newly allocated npm --cache directory. Reusing an already populated cache is not a cold-cache check; do not purge a global cache to simulate it.

### Cleanup

Keep published artifacts/checksums as release evidence. Remove only task-owned temporary directories after verifying their resolved paths; never recursively clean the repository or a shared npm cache.

### Troubleshooting Notes

Explicit LF compiler output removes host newline ambiguity. Archive source-map paths must resolve to shipped src files. A raw .cast source is linked, not expected to render inline. MacOS and physical console Ctrl+C are not established by the four-job matrix.

## Recording

Last verified: 2026-11-11.

### Purpose

Capture actual offline CLI output and timing for the README, separately from synthetic provider latency.

### Setup / Seed Data

Build the CLI; use only the interrupted demo. No credentials required.

### Safe Actions

`npm run record:demo` captures merged stdout/stderr as an asciicast v2 recording and verifies actual exit 3.

### Destructive / Mutating Actions

Recording overwrites only docs/demo.cast. README animation is a rendering of that recording; it is not a mock terminal transcript.

### Steps

1. Run `npm run record:demo`.
2. Render docs/demo.cast into docs/demo.gif with an asciicast-compatible renderer.
3. Inspect the final animation frame against the captured output. Keep the synthetic/offline label.

### Verification Commands

```sh
npm run record:demo
```

Expected: actual exit 3, partial text plus provider-failure summary; recording header includes terminal dimensions and only TERM metadata. The initial recording has three output events and a four-frame GIF, visually checked locally.

### Cleanup

No recording process remains running. Renderer scratch files stay ignored and are not package/runtime dependencies.

### Troubleshooting Notes

Re-render the GIF when updating the captured recording. Do not advertise demo timings as live measurements. Python is not required to build, test, or use StreamCheck.

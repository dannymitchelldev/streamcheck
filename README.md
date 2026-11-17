# StreamCheck

[![Verify package](https://github.com/dannymitchelldev/streamcheck/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dannymitchelldev/streamcheck/actions/workflows/ci.yml?query=branch%3Amain)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Diagnose failed OpenRouter streams without losing the text you already received.**

An HTTP 200 can still end in a failed generation. StreamCheck wraps the official OpenRouter TypeScript SDK with explicit outcomes, timing, and preserved partial text. Use the library in a stream consumer or the CLI to reproduce and inspect failures.

**Offline demo result · HTTP 200 · Interrupted · Partial text preserved**

> Webhooks send HTTP notifications when an event

The demo simulates a provider error after text arrives. StreamCheck reports the failure and returns the text it received.

[Try the offline CLI](#try-it-in-five-minutes) · [Use the TypeScript library](#library) · [See outcomes and exit codes](#results-and-completion)

## Try it in five minutes

Install [v0.3.0 from GitHub Releases](https://github.com/dannymitchelldev/streamcheck/releases/tag/v0.3.0) in a project directory with Node.js **22.12+** and npm.

```sh
npm install --ignore-scripts https://github.com/dannymitchelldev/streamcheck/releases/download/v0.3.0/streamcheck-0.3.0.tgz
```

The offline demo needs no API key or provider request. It exits **3** by design.

```sh
npx --no-install streamcheck demo interrupted
```

The CLI prints the received text to stdout and the outcome, HTTP status, and timing to stderr. Add `--json` for a single structured result on stdout. Use `--help` to see the other demo scenarios.

<details>
<summary>Watch the offline CLI recording</summary>

![An HTTP 200 stream fails after text arrives, and StreamCheck preserves the partial text.](docs/demo.gif)

Recorded against a synthetic HTTP/SSE fixture. Timings are from the fixture. [Raw recording](docs/demo.cast).

</details>

## Library

Use the same release install command in an ESM project.

```typescript
import { runDemo, type RunResult } from 'streamcheck';

const result: RunResult = await runDemo({
  scenario: 'interrupted',
  onText(delta) { process.stdout.write(delta); },
});

if (result.outcome === 'interrupted') {
  console.log(result.error.kind); // provider
  console.log(result.text);       // retained exactly
}
```

Use `runStreamCheck` for a live request with `apiKey`, `model`, and either `prompt` or a nonempty `messages` array. See the [conversation example](examples/conversation.ts) and [API contract](docs/design.md#public-interface) for options and validation.

In v0.3.0, set `idleTimeoutMs` in the library or `--idle-timeout-ms` in the CLI to detect stalled text after the first delta. The overall deadline still applies. An idle timeout preserves received text and exits **124** in the CLI.

## Results and completion

| Outcome | Meaning | Default CLI exit |
| --- | --- | ---: |
| `success` | Normal finish and complete `[DONE]` event observed | 0 |
| `failed` | Failure before receiving text | 1 |
| `interrupted` | Failure with received text preserved | 3 |
| `cancelled` | Caller cancellation, with any text preserved | 130 |

Every input/configuration diagnostic exits **2**. Timeout exits **124**, including when its outcome is `interrupted`. `--help` and `--version` exit 0; `--json` applies to run/demo results rather than help/version.

`schemaVersion: 1` results include exact text, timing, observed HTTP status, first finish reason, and warnings. Unknown metadata is `null`. Failed/interrupted results add `error: { kind, phase, message, code? }`; cancellation records `reason: 'caller'`. See the [public TypeScript types](src/types.ts) for every field.

See the [design contract](docs/design.md) for completion, callback, cancellation, and timing rules.

## Cloudflare Workers runtime

The installed ESM library was verified locally with **workerd 1.20260730.1**, compatibility date **2026-07-30**, and **`nodejs_compat`**. The CLI requires Node.js. See the [Workers runbook](docs/testing-runbook.md#packed-package-workers-verification) for the synthetic runtime checks and their scope.

## Why these decisions?

| Decision | Reason |
| --- | --- |
| Keep finish reasons provisional while draining | A later observable failure must not become a successful result |
| First accepted terminal outcome wins | Cancellation and deadline races need a deliberate, testable rule |
| Preserve text before calling the consumer | A broken callback must not discard its triggering delta |
| Disable retries | Repeating a partially delivered generation can duplicate output and add charges |
| Let the official SDK parse SSE | Keep the contribution focused on diagnostics and a stable outcome contract |

The [design contract](docs/design.md) describes the edge cases. An [independent AI review](docs/engineering-log.md) caught a false-success case involving another completion choice; the correction has a regression test.

## Explicit live use

Configure `OPENROUTER_API_KEY` in your environment without placing it in source or command-line flags. Select a current model ID from OpenRouter, then run:

```sh
node dist/bin.js run --model <model-id> --prompt "Explain webhooks" --max-tokens 256 --timeout 30000
```

That command explicitly makes a potentially billable request. The library equivalent is `runStreamCheck({ apiKey, model, prompt, signal, onText })`. `npm run example:live -- <model-id>` runs the live TypeScript example. Automated verification never runs either live entry point.

For bounded live interruption checks, see the [manual interruption runbook](docs/testing-runbook.md#manual-live-interruption-checks).

The published v0.3.0 CLI preserved the first text delta byte for byte and exited **124** after a locally injected stall in a live OpenRouter stream on Windows. The receipt includes the exact-output check and the Windows preload fix. [v0.3.0 live idle timeout receipt](docs/verification/live-idle-timeout-v0.3.0.json)

## Troubleshooting and limits

| Symptom | Interpretation |
| --- | --- |
| HTTP 401 / 429 | Request failed before streaming: authentication / rate limiting |
| HTTP 200 plus provider diagnostic | Valid provider error arrived inside the stream, possibly before any text |
| Protocol diagnostic | SDK rejected a payload, a finish reason or `[DONE]` was missing, a trailing frame was unfinished, finish reasons conflicted, or tool calls appeared |
| Timeout after a finish reason | The finish remained provisional while the stream drained |
| Null HTTP status | No response metadata was available; StreamCheck never assumes 200 |

The SDK is pinned to **1.5.91**. It accepts numeric Chat Completions error codes; a string-valued `error.code` in a chat-stream chunk is rejected as a protocol diagnostic, with previously received text retained. Current [OpenRouter documentation](https://openrouter.ai/docs/api_reference/errors-and-debugging) specifies numeric codes for Chat Completions and string codes for the separate Responses API.

StreamCheck observes SSE framing through its custom fetch seam while the official SDK parses and validates payloads. This detects a missing `[DONE]` or unfinished event at EOF. Observation ends at the first complete `[DONE]`, matching the SDK's cancellation behavior; it does not establish HTTP EOF, inspect bytes after that terminal event, or prove an upstream root cause.

Configured API keys, authorization headers, and raw SDK exceptions are never logged. User prompts and model text are not automatically redacted and may themselves contain secrets. There is no telemetry or output persistence.

Retrying or resuming after partial output can duplicate text and incur additional charges. Local cancellation does not guarantee that a provider stops processing or billing. See [OpenRouter streaming and error handling](https://openrouter.ai/docs/api_reference/streaming).

## Run from source

```sh
git clone https://github.com/dannymitchelldev/streamcheck.git
cd streamcheck
npm ci --ignore-scripts
npm run build
node dist/bin.js demo interrupted
```

## Verify and review

```sh
npm run check
npm run example:demo
npm run test:workers
```

The full check includes `test:workers`, types, library/CLI tests, release checks, and consumers of the actual packed package outside the checkout. It inspects archive contents, LF shebang, relative source maps, ESM exports, positive/negative conversation declarations, and the installed CLI. Dependency installation may use npm; provider execution uses fixtures and is blocked from network access. Package verification also requires the standard `tar` command. Keep npm optional dependencies enabled: esbuild and workerd use platform binaries and support the existing `npm ci --ignore-scripts` installation.

CI runs **Windows/Ubuntu × Node 22.12.0/24**. [View actual runs](https://github.com/dannymitchelldev/streamcheck/actions/workflows/ci.yml?query=branch%3Amain); release notes link the exact validated commit. macOS, live provider behavior, and physical console Ctrl+C are not established by this matrix.

A separate [live OpenRouter smoke check](docs/verification/live-provider-2026-11-12.json) passed on 2026-11-12 with `openai/gpt-4.1-nano`, StreamCheck v0.1.1, and Windows / Node 24.18.0: HTTP 200, exact marker text, normal stop, and CLI exit 0. [Three live-stream fault checks](docs/verification/live-interruptions-2026-11-12.json) also passed on that model/platform: caller cancellation, locally injected transport failure, and a locally stalled deadline all retained their exact received text. The latter checks use the library and shared CLI exit mapper; production-bin subprocess behavior, physical console Ctrl+C, naturally occurring upstream errors, and sustained reliability remain separate verification boundaries. [Reproduction steps](docs/testing-runbook.md#manual-live-interruption-checks).

Built with Codex from a reviewed contract, with a separate AI implementation review and reproduced corrections. Human implementation review is not claimed. The [engineering record](docs/engineering-log.md) separates those stages; the [testing runbook](docs/testing-runbook.md) documents reproducible verification. [Contributions](CONTRIBUTING.md) are welcome under [MIT](LICENSE).

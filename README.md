# StreamCheck

[![Verify package](https://github.com/dannymitchelldev/streamcheck/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dannymitchelldev/streamcheck/actions/workflows/ci.yml?query=branch%3Amain)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Diagnose failed OpenRouter streams without losing the text you already received.**

An HTTP 200 can still end in a failed generation. StreamCheck wraps the official OpenRouter TypeScript SDK with explicit outcomes, timing, and preserved partial text. Use the library in a stream consumer or the CLI to reproduce and inspect failures.

![Actual offline interrupted-stream recording](docs/demo.gif)

The recording is an actual CLI run against a synthetic HTTP/SSE fixture. Its delays are not live model performance. [Raw recording](docs/demo.cast).

## Try it in five minutes

Node.js **22.12+** and npm are required:

```sh
git clone https://github.com/dannymitchelldev/streamcheck.git
cd streamcheck
npm ci --ignore-scripts
npm run build
node dist/bin.js demo interrupted
```

No API key, provider request, or account setup is needed. Dependency installation uses npm; demos and tests use in-process synthetic HTTP/SSE responses through the real SDK.

The demo intentionally exits **3**:

```text
Webhooks send HTTP notifications when an event

[Offline demo]
Outcome:         Interrupted
First token:     125 ms
Elapsed:         352 ms
Partial output:  Preserved
HTTP status:     200
Failure:         Provider error during streaming
```

Timings vary between runs.

Other scenarios and machine-readable output:

```sh
node dist/bin.js demo success
node dist/bin.js demo auth-failure --json
node dist/bin.js demo rate-limit --json
node dist/bin.js demo interrupted --json
node dist/bin.js --help
```

Human mode sends exact received text to stdout and its summary to stderr. JSON mode sends one complete result to stdout; no streamed fragments, banners, or SDK logs. Use the executable directly when piping JSON; npm script banners are separate from CLI output.

## Library

From another ESM project, install the [GitHub release](https://github.com/dannymitchelldev/streamcheck/releases/tag/v0.2.0):

```sh
npm install --ignore-scripts https://github.com/dannymitchelldev/streamcheck/releases/download/v0.2.0/streamcheck-0.2.0.tgz
```

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

In the checkout, run the typed example with `npm run example:demo`. Distribution is through GitHub Releases. The package's `private: true` flag prevents accidental npm registry publication; it does not prevent installation of the release tarball.

The two public operations are:

```typescript
runStreamCheck(options: LiveOptions): Promise<RunResult>
runDemo(options?: DemoOptions): Promise<RunResult>
```

Live options require `apiKey`, `model`, and exactly one of `prompt` or a nonempty `messages` array; both operations accept `signal`, `timeoutMs`, and synchronous `onText`. Defaults are a 30,000 ms overall deadline and, for live runs, 256 maximum output tokens. No retries or automatic continuation occur.

Set `idleTimeoutMs` in either library operation or pass `--idle-timeout-ms <ms>` to CLI `run` or `demo` to detect stalled text output. The idle timeout is disabled by default and accepts integer values from 1 to 2,147,483,647 milliseconds. The timer starts on the first nonempty text delta and resets on each subsequent nonempty delta, including while waiting for stream completion. The overall deadline still covers the entire run. Idle expiry preserves the received text and returns an `interrupted` timeout diagnostic (CLI exit 124).

Conversation input and the Workers verification below are available starting with **v0.2.0**. Earlier v0.1.1 artifacts remain prompt-only.

```typescript
import { runStreamCheck, type TextMessage } from 'streamcheck';

const messages: readonly [TextMessage, ...TextMessage[]] = [
  { role: 'system', content: 'Explain concepts concisely.' },
  { role: 'user', content: 'What is a webhook?' },
  { role: 'assistant', content: 'An HTTP notification sent when an event occurs.' },
  { role: 'user', content: 'How does the receiver acknowledge it?' },
];
// Explicitly calling this makes one potentially billable provider request.
const result = await runStreamCheck({ apiKey, model, messages, onText(delta) { console.log(delta); } });
```

`TextMessage` supports only `system`, `user`, and `assistant` with nonblank string content. Each entry must be a plain object containing only `role` and `content`; tools, images, and extra fields are rejected. Roles, order, whitespace, and content reach the SDK unchanged. The readonly tuple annotation proves nonemptiness in TypeScript; runtime validation also protects JavaScript callers. Supplying both input properties (even an explicit `undefined`) or neither returns an input/setup diagnostic before transport. An already-aborted signal retains cancellation precedence over invalid options.

Enable TypeScript's `exactOptionalPropertyTypes` to reject an explicitly undefined opposite input at compile time too. Runtime validation always rejects it.

The CLI continues to accept `--prompt`; conversation input is a library API. The application owns history and decides whether an interrupted or warning-bearing answer belongs in it. [Conversation example](https://github.com/dannymitchelldev/streamcheck/blob/v0.2.0/examples/conversation.ts) is compiled, without executing a provider call, by `npm run example:demo`.

An API key that cannot form a valid HTTP authorization header returns an input diagnostic before any request is sent.

A syntactically valid rejected credential requires a provider response: synthetic HTTP 401 is tested as a request failure after one intercepted request.

## Cloudflare Workers runtime

The installed packed ESM package is verified inside **workerd 1.20260730.1**, compatibility date **2026-07-30**, with **`nodejs_compat`**. This flag is required for the library's native `node:http` header validation. The pinned SDK remains **1.5.91**. The library exports work in this tested runtime; the CLI requires Node.js.

```sh
npm run test:workers
# Verify an existing candidate without repacking it:
npm run test:workers -- <path-to-candidate.tgz>
```

This builds, installs a tarball outside the checkout, bundles its public exports with pinned esbuild, and runs HTTP/SSE fixtures through the real SDK inside workerd. It covers conversation/prompt requests, validation, HTTP/provider/protocol failures, provisional completion, interruption, cancellation, deadlines, synchronous callback failures, warnings, empty success, and reader/listener cleanup. The report identifies the archive SHA-256, versions, compatibility settings, cases, intercepted requests, and zero external requests. An explicit deny service replaces workerd's implicit internet service; no provider credentials, network fallback, deployment, or Cloudflare account is used. See the [Workers runbook](docs/testing-runbook.md#packed-package-workers-verification).

This is synthetic local runtime evidence. It does not establish deployed behavior, live-provider reliability, other compatibility dates/flags, or cessation of provider billing after cancellation.

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

From a source checkout, explicitly verify interruption handling with three bounded live requests:

```sh
npm run test:live:interruptions -- --live --env-file=.env
```

Omit `--env-file` when `OPENROUTER_API_KEY` is already in the environment. This manual command uses `openai/gpt-4.1-nano`, up to 128 output tokens and a 30-second deadline per request, with no retries. After decoded text arrives, it separately cancels, injects a transport read error, and stalls local delivery until the deadline. It checks exact text preservation and the shared CLI exit mapping, then writes evidence under ignored `.work/live-interruptions/`. It exits 0 only when every case passes; it does not run the production CLI subprocess or physical Ctrl+C. The command refuses to run when `CI` is set and is excluded from `npm run check` and the CI workflow. [Manual interruption runbook](docs/testing-runbook.md#manual-live-interruption-checks).

## Results and completion

| Outcome | Meaning | Default CLI exit |
| --- | --- | ---: |
| `success` | Normal finish and complete `[DONE]` event observed | 0 |
| `failed` | Failure before receiving text | 1 |
| `interrupted` | Failure with received text preserved | 3 |
| `cancelled` | Caller cancellation, with any text preserved | 130 |

Every input/configuration diagnostic exits **2**. Timeout exits **124**, including when its outcome is `interrupted`. `--help` and `--version` exit 0; `--json` applies to run/demo results rather than help/version.

`schemaVersion: 1` results include exact text, timing, observed HTTP status, first finish reason, and warnings. Unknown metadata is `null`. Failed/interrupted results add `error: { kind, phase, message, code? }`; cancellation records `reason: 'caller'`. See the [public TypeScript types](src/types.ts) for every field.

- **Partial output:** true exactly when text is nonempty and normal completion was not accepted. Successful `length` and `content_filter` results set it false and carry `token_limit` / `content_filter` warnings. The flag does not judge answer quality.
- **Completion:** success requires a normal finish reason and a complete SSE `[DONE]` event. A normal finish remains provisional while accounting frames drain; EOF without `[DONE]` or with an unfinished trailing frame is a protocol diagnostic, with received text retained. A later provider error, conflict, cancellation, or deadline can still win. Identical repeated reasons are harmless. Tool calls are unsupported.
- **Cancellation:** first accepted terminal outcome wins. Deadline and caller-abort handlers record their cause before aborting transport. A pre-aborted signal sends no request. Accepted success survives later cancellation.
- **Callbacks:** each text delta is accumulated before synchronous `onText`. A thrown callback preserves its triggering delta. The first observed finish reason is retained even when a callback throws or cancels on the same frame. Do not pass async callbacks; promises and asynchronous rejections are outside this contract.
- **Timing:** first-token time means time to the first nonempty text delta. It excludes initial module loading and is not a tokenizer measurement. Elapsed time ends when a terminal outcome is accepted, before final cleanup.

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

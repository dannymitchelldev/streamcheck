# Changelog

## 0.3.0 — 2026-11-17

- Add opt-in `--idle-timeout-ms` for CLI `run` and `demo` and `idleTimeoutMs` for both library entry points. The timer starts after the first nonempty text delta, resets on each subsequent one, and stays active while the stream drains. The overall deadline remains in force.
- Preserve exact partial output on idle expiry and report a distinct timeout diagnostic with CLI exit code 124. Offline tests cover stalls, timer resets, deadline precedence, and CLI validation. [PR #9](https://github.com/dannymitchelldev/streamcheck/pull/9)

## 0.2.0 — 2026-11-14

- Add role-preserving text conversations through exported `TextMessage` and exclusive `prompt`/nonempty `messages` input. Preserve existing prompt callers, CLI behavior, defaults, result types, synchronous callbacks, and terminal precedence. Implements [#5](https://github.com/dannymitchelldev/streamcheck/issues/5).
- Verify the installed packed package's public exports in workerd with synthetic HTTP/SSE fixtures, pinned compatibility settings, and blocked external traffic. Include the Workers gate in the Windows/Ubuntu × Node 22.12.0/24 full check.
- Add an explicitly invoked, bounded manual live-interruption verification command, excluded from automated checks. Offline coverage uses only synthetic fixtures; prior live receipts remain tied to their recorded revisions.

- Require a complete SSE `[DONE]` event as well as a normal finish reason before accepting success. Report missing markers and unfinished trailing frames as protocol diagnostics while preserving received text.
- Observe framing through the existing custom fetch seam, keeping the pinned SDK for payload parsing and validation, with bounded framing state and source-reader cleanup.
- Add completion-framing regressions and correct the distinction between numeric Chat Completions error codes and string Responses API codes.

## 0.1.1 — 2026-11-12

- Reject malformed API-key header values as input diagnostics before transport, with CLI exit 2 and no credential disclosure. Fixes [#1](https://github.com/dannymitchelldev/streamcheck/issues/1).
- Preserve the first observed finish reason when `onText` throws or synchronously cancels on a combined text/finish frame, while retaining text and terminal-outcome precedence. Fixes [#2](https://github.com/dannymitchelldev/streamcheck/issues/2).
- Add regression and normalization-control coverage, and block provider network access in CLI test subprocesses.

## 0.1.0 — 2026-11-12

Initial release.

- Typed results for success, failure, interrupted output, and caller cancellation.
- One text-stream operation through the official OpenRouter TypeScript SDK.
- CLI streaming output, single-object JSON, documented exit codes, deadlines, and Ctrl+C handling.
- Four credential-free demos exercising HTTP/SSE responses through the real SDK.
- Partial-text preservation and explicit provider/protocol diagnostics, with retries disabled.
- Package-consumer checks, source-map/shebang guards, and release checksums.

Known limits: the pinned SDK hides DONE versus EOF and can discard incomplete trailing frames. Live provider behavior, macOS, and physical console Ctrl+C are not claimed as verified. See the design and testing documentation.

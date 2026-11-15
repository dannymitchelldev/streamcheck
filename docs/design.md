# StreamCheck v0.2 contract

One ESM TypeScript package, one text-stream operation through the official OpenRouter SDK, and one CLI. Offline demos exercise that SDK with synthetic HTTP/SSE responses. No retries or persistence.

## Public interface

`runStreamCheck(LiveOptions): Promise<RunResult>` and `runDemo(DemoOptions?): Promise<RunResult>` expose success, failure without text, interruption with text, and caller cancellation. The CLI consumes these public functions. Defaults: 30,000 ms overall deadline, 256 maximum output tokens, interrupted demo.

`LiveOptions` is an exclusive union: either a nonblank `prompt` string or a nonempty readonly tuple of `TextMessage` entries. `TextMessage` has `role: 'system' | 'user' | 'assistant'` and nonblank string `content`. Entries must be plain objects containing only those two fields. Validate both/neither input, empty/malformed messages, unsupported roles, extra/tool/image structures, and missing/blank/locally malformed credentials before SDK construction or transport. Explicitly supplying both properties, including an undefined property, is invalid at runtime. A pre-aborted caller signal still returns cancellation before option validation. A syntactically valid rejected credential is an HTTP request failure, not a locally knowable input failure.

The prompt path sends one user message. The conversation path copies the supplied roles and content in order without trimming, flattening, mutating history, or adding messages. Results, defaults, synchronous callbacks, CLI prompt behavior, retries, and terminal precedence are shared. Consumer history policy, tools, images, automatic continuation, persistence, and asynchronous callbacks remain outside the contract.

Normal finish reasons are provisional until SDK iteration ends and a complete SSE [DONE] event has been observed. Stop succeeds; length and content_filter succeed with warnings. EOF without [DONE] or with an unfinished trailing event is a protocol failure. Identical repeated normal reasons are accounting duplicates; conflicting normal reasons are protocol failures. Valid provider errors are provider failures. Tool calls are unsupported protocol failures. Schema-rejected events are protocol failures, with no attempt to mine rejected payloads for provider codes.

Only completion choice index zero is supported. An unexpected index or duplicate choice entry is a protocol failure; text from an ambiguous frame is not merged into the selected stream. Previously accepted text is retained. Empty-choice accounting frames are allowed.

`partialOutput` means nonempty received text exists and normal completion was not accepted. It is false for successful length/content_filter results; warnings describe their limitation. Text is appended before calling synchronous onText, including the delta whose callback throws. Async callbacks/rejections are outside the contract.

First accepted terminal outcome wins. Timeout and caller cancellation record their origin before aborting transport. A pre-aborted caller signal returns cancellation before a request. Success is accepted only at SDK iterator exhaustion with both a normal finish and a complete [DONE], so an earlier observable error or timeout while draining wins. Framing checks at exhaustion do not override accepted provider, network, consumer, timeout, or cancellation outcomes. First-token latency is time to first nonempty text delta, not a tokenizer measurement.

## SDK boundary

Pin @openrouter/sdk 1.5.91. Disable retries and inject a no-op debug logger. Observe real response status; use null when unavailable and never infer 200. The internal custom fetcher wraps successful SSE bodies with pull-based byte forwarding, preserving response status/headers and SDK input bytes. Forward cancellation and transport errors and release the source reader at EOF, error, or cancellation. Preserve exact decoded text, not raw SDK exceptions or HTTP request metadata.

The SDK hides whether [DONE] arrived and drops incomplete trailing events at EOF. A separate bounded framing observer closes that visibility gap: it handles UTF-8/BOM and LF, CRLF, or CR line endings incrementally, retaining only a short line prefix and event flags. It requires an exact single data value [DONE] terminated by a blank line; matching text inside content, comments, or unrelated fields does not certify completion. JSON decoding and validation remain with the SDK. There is no tee or full-body buffering.

The application boundary is the first complete [DONE] event, where the SDK cancels its reader. Bytes after that boundary and full HTTP EOF are not verified. Numeric typed Chat Completions provider codes may be retained; rejected string-code errors remain protocol diagnostics. Current OpenRouter documentation uses numeric codes for Chat Completions and string codes for the separate Responses API.

## CLI and boundaries

The packed library is exercised in workerd 1.20260730.1 with compatibility date 2026-07-30 and `nodejs_compat`, including native `node:http` header validation. No compatibility shim or SDK upgrade is needed for this tested configuration. The CLI remains Node-only. Other runtime dates/flags and deployed/live-provider behavior require separate evidence.

`npm run test:workers` builds and installs an actual tarball in a temporary consumer outside the checkout. Pinned esbuild bundles only the installed public ESM export and its dependencies, leaving `node:*` native. Workerd's test handler runs synthetic HTTP/SSE fixtures through the public operations and real SDK. Global fetch interception observes the effective signal (`init?.signal ?? request.signal`); an explicit non-network internet service denies any escaped fetch, and the host fails on a denial marker. No socket, external service, or network service is configured. The report binds results to archive SHA-256 and exact tool/runtime settings. An explicit archive argument verifies those same bytes without repacking.

Run explicitly makes a live call using OPENROUTER_API_KEY; demo never uses network or ambient credentials. Human text goes to stdout and summary to stderr. JSON is one complete result on stdout. Exit codes: success 0, failure 1, any input diagnostic 2, interruption 3, timeout 124, caller cancellation 130.

Configured credentials, authorization headers, and raw SDK errors are never logged. Prompts and returned text are not automatically redacted. No automatic retry or resume: these can duplicate output and incur additional charges. Cancelling a local stream does not guarantee provider processing or billing stops.

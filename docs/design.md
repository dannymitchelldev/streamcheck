# StreamCheck v0.1 contract

One ESM TypeScript package, one text-stream operation through the official OpenRouter SDK, and one CLI. Offline demos exercise that SDK with synthetic HTTP/SSE responses. No retries or persistence.

## Public interface

`runStreamCheck(LiveOptions): Promise<RunResult>` and `runDemo(DemoOptions?): Promise<RunResult>` expose success, failure without text, interruption with text, and caller cancellation. The CLI consumes these public functions. Defaults: 30,000 ms overall deadline, 256 maximum output tokens, interrupted demo.

Normal finish reasons are provisional until SDK iteration ends. Stop succeeds; length and content_filter succeed with warnings. Identical repeated normal reasons are accounting duplicates; conflicting normal reasons are protocol failures. Valid provider errors are provider failures. Tool calls are unsupported protocol failures. Schema-rejected events are protocol failures, with no attempt to mine rejected payloads for provider codes.

Only completion choice index zero is supported. An unexpected index or duplicate choice entry is a protocol failure; text from an ambiguous frame is not merged into the selected stream. Previously accepted text is retained. Empty-choice accounting frames are allowed.

`partialOutput` means nonempty received text exists and normal completion was not accepted. It is false for successful length/content_filter results; warnings describe their limitation. Text is appended before calling synchronous onText, including the delta whose callback throws. Async callbacks/rejections are outside the contract.

First accepted terminal outcome wins. Timeout and caller cancellation record their origin before aborting transport. A pre-aborted caller signal returns cancellation before a request. Success is accepted only at SDK iterator exhaustion, so an earlier observable error or timeout while draining wins. First-token latency is time to first nonempty text delta, not a tokenizer measurement.

## SDK boundary

Pin @openrouter/sdk 1.5.91. Disable retries and inject a no-op debug logger. Observe real response status without consuming or changing responses; use null when unavailable. Never infer 200. Preserve exact decoded text, not raw SDK exceptions or HTTP request metadata.

The SDK hides whether [DONE] arrived and drops incomplete trailing frames at EOF. An observed normal reason followed by an incomplete trailing error frame can therefore succeed. StreamCheck reports SDK-observed completion, not verified complete transport. Numeric typed provider codes may be retained; rejected string-code errors are protocol diagnostics.

## CLI and boundaries

Run explicitly makes a live call using OPENROUTER_API_KEY; demo never uses network or ambient credentials. Human text goes to stdout and summary to stderr. JSON is one complete result on stdout. Exit codes: success 0, failure 1, any input diagnostic 2, interruption 3, timeout 124, caller cancellation 130.

Configured credentials, authorization headers, and raw SDK errors are never logged. Prompts and returned text are not automatically redacted. No automatic retry or resume: these can duplicate output and incur additional charges. Cancelling a local stream does not guarantee provider processing or billing stops.

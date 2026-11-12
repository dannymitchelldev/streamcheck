# Implementation and review record

## v0.1.0 implementation

AI-assisted implementation from an explicitly reviewed, bounded design. Product code is TypeScript; one package contains the library and CLI. The initial build was local; the first public release adds packaging and distribution checks without changing the library contract.

1. Added SDK-boundary tests before the adapter. Initial run failed because the adapter did not exist; the minimal adapter passed seven executable checks against SDK 1.5.91.
2. Added runner tests before the implementation. Initial run failed because the runner did not exist. The implementation passed 42 stream/validation/lifecycle cases.
3. Added demo and CLI tests before those modules. Initial runs failed on missing modules. Built-library and real CLI subprocess checks then passed: **80 tests total** on Windows / Node 24.18.0.
4. Packed package passed a fresh consumer: offline dependency install, ESM import, TypeScript declarations, and installed CLI. Both typed examples compile; the offline example runs.
5. Captured actual offline CLI output/timestamps and exit 3 as asciicast v2. Rendered and visually checked the README GIF.
6. After the review corrections, clean offline `npm ci --ignore-scripts --offline --no-audit --no-fund` succeeded. Final `npm run check` passed type checks, build, **93/93 tests** (54.60 seconds), and a fresh packed consumer on Windows / Node 24.18.0.

## Deliberate decisions

- Finish reasons remain provisional while draining; accepted outcomes are immutable.
- `partialOutput` describes retained text without accepted completion. Warnings separately describe token limits/filtering.
- SDK validation errors stay protocol errors; no custom SSE parsing or rejected-payload recovery.
- Silent SDK EOF/trailing-frame behavior is a documented, tested limitation.
- Explicit fixed service URL prevents ambient SDK base-URL overrides from changing the one-provider integration; demo transport rejects unexpected requests without network fallback.
- No-op logging prevents SDK environment debugging from disclosing authorization headers.

## Verification status

| Surface | Status |
| --- | --- |
| SDK compatibility gate | Passed locally: 7 tests |
| Library + CLI + demos | Final post-correction suite passed locally: 93 tests |
| Type checks | Passed locally |
| Packed package / fresh consumer | Passed locally, including offline cache-only installation |
| Typed examples | Both compile; offline example executed; live example not executed |
| Windows/Ubuntu, Node 22.12.0/24 GitHub Actions | [Current workflow results](https://github.com/dannymitchelldev/streamcheck/actions/workflows/ci.yml?query=branch%3Amain); release notes identify the validated commit |
| Live OpenRouter integration | One bounded v0.1.1 CLI smoke passed on 2026-11-12: Windows / Node 24.18.0 / `openai/gpt-4.1-nano`; [receipt](verification/live-provider-2026-11-12.json) |
| Live text with injected local faults | Three manual library cases passed on 2026-11-12: caller abort, transport read failure, and stalled deadline; [receipt](verification/live-interruptions-2026-11-12.json) |
| SIGINT handling | Portable subprocess event harness passed; physical Windows console Ctrl+C unverified |

## Reviews

- Design review: completed before implementation; clarified partial-output meaning, draining, race precedence, validation, and honest evidence boundaries.
- Independent implementation review: **completed**, read-only, against source/tests/package. Found no Critical issues, one Important issue, and two initially Minor issues; all three were corrected. The author verified corrections with regression tests; no independent re-review of the corrections is claimed.
- Human implementation review: **pending**. Test success does not complete either review.

## Corrections

1. **Cross-choice false success:** only choice zero text was accumulated, but another choice's finish reason could certify it. Unexpected indices and duplicate choice entries now fail as protocol errors before ambiguous text is merged; previously accepted text remains intact.
2. **Malformed CLI options swallowed JSON intent:** a missing value before `--json` could produce human output. Standalone JSON intent is now recovered before the `--` terminator, while `--prompt=--json` remains a literal value.
3. **Unsupported HTTP responses mislabeled internal:** known SDK unsupported-response errors now produce protocol diagnostics with the real observed status and no raw response disclosure.

The two initially Minor findings were treated as contract-impacting for this diagnostic tool and fixed in the same bounded pass. Regression run reproduced **10 failures**, then all **13 targeted cases** passed, including literal-argument and missing-credential guards. The final 93-test suite and packed-consumer check also passed. No review findings remain deferred.

## Remaining verification boundaries

The original local evidence covered Windows / Node 24.18.0. The release workflow records the additional platform/runtime evidence at its actual commit. Later live checks verified one successful completion and three locally induced fault paths on the recorded model/platform. Naturally occurring upstream provider failures, macOS, physical console Ctrl+C, and human implementation review remain unverified. The intentionally accepted SDK trailing-frame blind spot remains documented.

## Publication checks

A clean-cache preflight reproduced an ENOTCACHED failure: npm ci cached dependency files, but did not provide every registry manifest needed for a separate offline consumer install. The consumer now permits ordinary dependency installation; runtime provider requests remain blocked. A second regression showed that the old smoke command ignored an explicit artifact path and repacked the checkout. The release mode now verifies the supplied artifact without changing its bytes.

Release regression tests were observed failing before these changes. The checksum test uses the known SHA-256 of "abc", checks LF/filename formatting, and detects changed bytes. Archive checks verify an LF shebang, shipped source-map sources, license, and approved contents. Current validation is recorded in the testing runbook and the linked CI runs.

Independent publication review (2026-11-12): completed by a separate AI reviewer over the 37-file public inventory, release scripts, metadata, workflow, tests, examples, and documentation. No Critical, Important, or Minor release defects were found. Core runtime correctness was outside this publication pass and remains covered by the earlier implementation review.

Local publication validation passed on Windows / Node 24.18.0 / npm 11.16.0 with a newly populated npm cache: type checks, build, **95/95 tests** (55.69 seconds), and archive/fresh-consumer checks. Locked dependency versions were unchanged. Two release tests were observed failing before implementation and passing afterward. The public release notes provide the exact-commit CI and downloaded-artifact receipts; this local result alone is not cross-platform evidence.

## v0.1.1 patch

The final public-release review reproduced two minor runtime defects, tracked as [#1](https://github.com/dannymitchelldev/streamcheck/issues/1) and [#2](https://github.com/dannymitchelldev/streamcheck/issues/2). Eight initial regression cases were observed failing against the v0.1.0 implementation before either fix.

- Validate the authorization-header value before SDK construction. Invalid embedded control characters and non-ByteString characters now return input/setup diagnostics without invoking transport or exposing the key. A genuine connection TypeError retains its network classification; a built-CLI regression checks JSON and exit 2.
- Record the first observed finish reason before invoking onText. Callback throw, synchronous caller abort, and abort-then-throw now retain the same frame's finish metadata and exact text. Finish reasons remain provisional; this does not accept success earlier or change which terminal outcome wins.

CLI test subprocesses now preload a provider-fetch guard. The patch changes no locked dependency versions and adds no public API fields.

Independent patch review caught a gap in Headers-only validation: SOH, vertical tab, and DEL are accepted by Headers but rejected by the Node transport. Four additional library/CLI cases were observed failing before adding Node's HTTP field-value validation after header normalization. A separate control preserves the SDK's existing trailing-whitespace normalization. The reviewer also caught a missing fetch guard on the SIGINT subprocess; it now uses the same preload as the other CLI tests.

All 14 targeted regression/control checks passed after these corrections. Final local `npm run check` passed type checks, build, **108/108 tests**, and the fresh packed-consumer check on Windows / Node 24.18.0. Independent AI patch re-review confirmed both review findings resolved, with no remaining runtime findings; additional offline probes covered malformed headers, normalization, genuine connection failure, callback races, and built-CLI JSON/exit codes. Release notes identify the final exact-commit CI run and archive verification. Human implementation review, live providers, macOS, and physical console Ctrl+C were outside that patch validation. The live smoke below is separate evidence.

## v0.1.1 live provider smoke

On 2026-11-12, the built CLI at `d9795dfb0cdc0fda6c37f887c49bb264d6179286` made one live OpenRouter invocation using `openai/gpt-4.1-nano`, a public marker prompt, 32 maximum output tokens, and a 30,000 ms deadline. The SDK retry strategy remained `none`; no transport fixture or automatic rerun was used. The offline check passed before the invocation on the same runtime source: types, build, **108/108 tests**, and the packed consumer.

The live CLI exited 0, emitted one schema-version-1 JSON result and no stderr, observed HTTP 200, and returned exactly `STREAMCHECK_OK` with `finishReason: stop`, `partialOutput: false`, no warnings, and no error diagnostic. First text arrived at **670.113 ms**; accepted completion was at **842.169 ms**. All 15 evidence assertions passed. These are observations from one request, not a latency benchmark.

The [receipt](verification/live-provider-2026-11-12.json) records the source commit, runtime, SDK, request bounds, result, output checksum, and assertions without credentials or account metadata. The [runbook](testing-runbook.md#live-openrouter-smoke-check) describes reproduction. This verifies successful live completion for that model/platform combination; live interruption/rate-limit/cancellation handling, sustained reliability, upstream provider identity, and billed cost were not measured. SDK-observed completion retains the documented trailing-frame limitation.

## Manual interruption harness

The source-checkout command `npm run test:live:interruptions -- --live` exercises caller cancellation, transport read failure, and a stalled deadline after SDK-decoded nonempty text. It uses the existing transport seam and unchanged native response bytes; production source, public API, dependencies, and CI workflow are unchanged. The script requires explicit live opt-in, rejects CI, permits one native request per case, runs cases sequentially, and saves incremental nonsecret receipts. Per-case CLI codes come from the shared production mapper; the production CLI binary and physical console Ctrl+C are outside this harness.

Eight initial offline harness cases failed before implementation, then passed through the real built runner and pinned SDK with synthetic transport only. A Windows preload-path failure was corrected by using file URLs. Independent read-only AI review examined request gates, buffered SSE events, text preservation, pending reads, fragmented UTF-8, cleanup, and evidence scope. It found one minor classification issue: already-buffered completion could make a stall experiment report failed rather than inconclusive. A new regression was observed failing before the correction and passing afterward; the reviewer confirmed the finding resolved with no additional correctness findings. The actual completion result and failed assertions remain visible, and inconclusive evidence never passes the overall command.

The final offline check passed type checks, build, **117/117 tests**, and the packed-package consumer. The implementation was committed as `9490d5311ccf2abb442f39516ca9169109dd1ec8` before live execution. A subsequent explicit invocation made exactly three live requests on Windows / Node 24.18.0 / SDK 1.5.91 / `openai/gpt-4.1-nano`; all **33 live evidence assertions passed**, and the manual command exited 0.

| Local fault | Actual result | Retained text | Elapsed | Shared CLI mapping |
| --- | --- | --- | ---: | ---: |
| Caller abort after text | `cancelled`, reason `caller` | `Sure` | 789.170 ms | 130 |
| Transport read error after text | `interrupted`, `network` / `stream` | `I` | 690.057 ms | 3 |
| Stalled local body until deadline | `interrupted`, `timeout` / `stream` | `I` | 30,003.504 ms | 124 |

Each case observed HTTP 200, retained exactly the text delivered through callbacks, set `partialOutput: true`, and completed upstream reader cancellation. The [receipt](verification/live-interruptions-2026-11-12.json) records actual results, failed-or-passed checks, injection timing, source/runtime checksums, and request bounds. The nominal deadline can be observed slightly late because timer execution is scheduled by the event loop. These results establish live client behavior under deliberate local faults; they do not establish a natural upstream error, physical console Ctrl+C, production-bin subprocess behavior, billing cessation, or long-term reliability.

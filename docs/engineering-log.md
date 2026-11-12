# Implementation and review record

## Implementation

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
| Live OpenRouter integration | Not run; offline SDK fixtures only |
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

The original local evidence covered Windows / Node 24.18.0. The release workflow records the additional platform/runtime evidence at its actual commit. Live provider behavior, macOS, physical console Ctrl+C, and human implementation review remain unverified. The intentionally accepted SDK trailing-frame blind spot remains documented.

## Publication checks

A clean-cache preflight reproduced an ENOTCACHED failure: npm ci cached dependency files, but did not provide every registry manifest needed for a separate offline consumer install. The consumer now permits ordinary dependency installation; runtime provider requests remain blocked. A second regression showed that the old smoke command ignored an explicit artifact path and repacked the checkout. The release mode now verifies the supplied artifact without changing its bytes.

Release regression tests were observed failing before these changes. The checksum test uses the known SHA-256 of "abc", checks LF/filename formatting, and detects changed bytes. Archive checks verify an LF shebang, shipped source-map sources, license, and approved contents. Current validation is recorded in the testing runbook and the linked CI runs.

Independent publication review (2026-11-12): completed by a separate AI reviewer over the 37-file public inventory, release scripts, metadata, workflow, tests, examples, and documentation. No Critical, Important, or Minor release defects were found. Core runtime correctness was outside this publication pass and remains covered by the earlier implementation review.

Local publication validation passed on Windows / Node 24.18.0 / npm 11.16.0 with a newly populated npm cache: type checks, build, **95/95 tests** (55.69 seconds), and archive/fresh-consumer checks. Locked dependency versions were unchanged. Two release tests were observed failing before implementation and passing afterward. The public release notes provide the exact-commit CI and downloaded-artifact receipts; this local result alone is not cross-platform evidence.

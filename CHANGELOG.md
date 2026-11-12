# Changelog

## 0.1.0 — 2026-11-12

Initial release.

- Typed results for success, failure, interrupted output, and caller cancellation.
- One text-stream operation through the official OpenRouter TypeScript SDK.
- CLI streaming output, single-object JSON, documented exit codes, deadlines, and Ctrl+C handling.
- Four credential-free demos exercising HTTP/SSE responses through the real SDK.
- Partial-text preservation and explicit provider/protocol diagnostics, with retries disabled.
- Package-consumer checks, source-map/shebang guards, and release checksums.

Known limits: the pinned SDK hides DONE versus EOF and can discard incomplete trailing frames. Live provider behavior, macOS, and physical console Ctrl+C are not claimed as verified. See the design and testing documentation.

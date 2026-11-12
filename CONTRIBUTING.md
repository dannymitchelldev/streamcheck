# Contributing

Use Node.js 22.12+ and npm; archive checks use the standard tar command.

```sh
npm ci --ignore-scripts
npm run check
npm run example:demo
```

The interrupted CLI demo intentionally exits 3. The TypeScript example handles its result and exits 0.

For bug reports, include the StreamCheck version, Node version, OS, expected outcome, actual outcome/exit code, and a small synthetic reproduction. Do not post API keys, private prompts, raw SDK exceptions, or sensitive generated text.

For changes, add a focused regression test and preserve the public outcome contract. Use the official SDK with an injected synthetic HTTP response; do not replace the stream consumer with a mock result. The test suite must not make provider calls. Dependency installation may use the npm registry.

Keep one provider integration, one streaming operation, and no automatic retries. Discuss public-contract changes before implementing them. See docs/design.md and docs/testing-runbook.md for the semantics and release procedure.

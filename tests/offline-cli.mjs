// CLI regressions must fail closed if validation accidentally reaches transport.
globalThis.fetch = () => { throw new Error('Provider network forbidden in CLI tests'); };

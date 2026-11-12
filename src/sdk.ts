import { OpenRouter } from '@openrouter/sdk';
import { HTTPClient, type Fetcher } from '@openrouter/sdk/lib/http.js';

const silentLogger = { log() {}, group() {}, groupEnd() {} };

/** Internal seam: the SDK still owns requests, validation, and SSE parsing. */
export function createSdk(apiKey: string, fetcher?: Fetcher, observe?: (response: Response) => void): OpenRouter {
  const httpClient = new HTTPClient(fetcher ? { fetcher } : {});
  if (observe) httpClient.addHook('response', response => { observe(response); });
  return new OpenRouter({
    apiKey,
    serverURL: 'https://openrouter.ai/api/v1',
    httpClient,
    retryConfig: { strategy: 'none' },
    debugLogger: silentLogger,
  });
}

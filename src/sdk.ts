import { OpenRouter } from '@openrouter/sdk';
import { HTTPClient, type Fetcher } from '@openrouter/sdk/lib/http.js';
import { observeSseCompletion, type SseCompletionObserver } from './sse-completion.js';

const silentLogger = { log() {}, group() {}, groupEnd() {} };

/** Internal seam: the SDK owns requests, JSON validation, and decoded SSE events. */
export function createSdk(apiKey: string, fetcher?: Fetcher, observe?: (response: Response) => void, completion?: SseCompletionObserver): OpenRouter {
  const observedFetcher: Fetcher | undefined = completion ? async (input, init) => {
    const response = await (fetcher ?? fetch)(input, init);
    return observeSseCompletion(response, completion);
  } : fetcher;
  const httpClient = new HTTPClient(observedFetcher ? { fetcher: observedFetcher } : {});
  if (observe) httpClient.addHook('response', response => { observe(response); });
  return new OpenRouter({
    apiKey,
    serverURL: 'https://openrouter.ai/api/v1',
    httpClient,
    retryConfig: { strategy: 'none' },
    debugLogger: silentLogger,
  });
}

export type DemoScenario = 'success' | 'auth-failure' | 'rate-limit' | 'interrupted';
export type WarningCode = 'token_limit' | 'content_filter';
export type ErrorKind = 'input' | 'http' | 'provider' | 'network' | 'protocol' | 'timeout' | 'consumer' | 'internal';
export type RunSource = 'live' | 'demo';

export interface CommonOptions {
  /** Overall deadline, including draining. Positive integer milliseconds; default 30,000. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Synchronous only. The delta is accumulated before this callback runs. */
  onText?: (delta: string) => void;
}

export interface LiveOptions extends CommonOptions {
  apiKey: string;
  model: string;
  prompt: string;
  /** Positive safe integer; default 256. Provider-specific limits still apply. */
  maxTokens?: number;
}

export interface DemoOptions extends CommonOptions {
  scenario?: DemoScenario;
}

export interface Diagnostic {
  readonly kind: ErrorKind;
  readonly phase: 'setup' | 'request' | 'stream';
  /** Normalized by StreamCheck; never a raw SDK exception. */
  readonly message: string;
  /** Only numeric, typed provider codes are retained by this SDK adapter. */
  readonly code?: number;
}

export interface ResultBase {
  readonly schemaVersion: 1;
  /** Null for an invalid invocation whose mode is not known. */
  readonly source: RunSource | null;
  readonly model: string | null;
  readonly text: string;
  /** Nonempty received text exists and normal completion was not accepted. */
  readonly partialOutput: boolean;
  /** Time to first nonempty text delta, not a tokenizer measurement. */
  readonly firstTokenMs: number | null;
  readonly elapsedMs: number;
  /** Observed response status only; never inferred from a successful SDK call. */
  readonly httpStatus: number | null;
  /** First observed finish reason. It remains provisional until SDK iteration ends. */
  readonly finishReason: string | null;
  readonly warnings: readonly WarningCode[];
}

export type SuccessResult = ResultBase & { readonly outcome: 'success'; readonly error?: never };
export type FailureResult = ResultBase & { readonly outcome: 'failed' | 'interrupted'; readonly error: Diagnostic };
export type CancelledResult = ResultBase & { readonly outcome: 'cancelled'; readonly reason: 'caller'; readonly error?: never };
export type RunResult = SuccessResult | FailureResult | CancelledResult;

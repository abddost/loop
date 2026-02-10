/**
 * Retry logic with exponential backoff for transient provider errors.
 *
 * Classifies errors as retryable (rate limits, overloaded, server errors)
 * and provides delay calculation with retry-after header parsing.
 */

/** Default retry configuration */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 5) */
  maxAttempts: number;
  /** Initial backoff delay in ms (default: 2000) */
  initialDelay: number;
  /** Backoff multiplier (default: 2) */
  backoffFactor: number;
  /** Maximum backoff delay in ms (default: 30000) */
  maxDelay: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  initialDelay: 2000,
  backoffFactor: 2,
  maxDelay: 30_000,
};

/** Patterns that indicate a retryable error */
const RETRYABLE_PATTERNS = [
  'rate_limit',
  'rate limit',
  'too_many_requests',
  '429',
  'overloaded',
  'exhausted',
  'unavailable',
  'server_error',
  'internal_server_error',
  '500',
  '502',
  '503',
  'no_kv_space',
  'capacity',
  'timeout',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
];

/**
 * Classify whether an error is retryable.
 * Returns a human-readable reason if retryable, or undefined if not.
 */
export function classifyRetryable(error: unknown): string | undefined {
  if (!error) return undefined;

  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  const combined = `${name} ${message}`.toLowerCase();

  // Check HTTP status if available
  const status = (error as { status?: number }).status;
  if (status === 429) return 'Rate limited (429)';
  if (status === 500) return 'Server error (500)';
  if (status === 502) return 'Bad gateway (502)';
  if (status === 503) return 'Service unavailable (503)';

  for (const pattern of RETRYABLE_PATTERNS) {
    if (combined.includes(pattern.toLowerCase())) {
      return `Retryable error: ${pattern}`;
    }
  }

  return undefined;
}

/**
 * Calculate the delay before the next retry attempt.
 * Respects retry-after headers when available.
 */
export function calculateRetryDelay(
  attempt: number,
  error: unknown,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  // Check for retry-after header (in ms or seconds)
  const headers = (error as { headers?: Record<string, string> }).headers;
  if (headers) {
    const retryAfterMs = headers['retry-after-ms'];
    if (retryAfterMs) {
      const ms = parseInt(retryAfterMs, 10);
      if (!isNaN(ms) && ms > 0) return Math.min(ms, config.maxDelay);
    }

    const retryAfter = headers['retry-after'];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, config.maxDelay);
      }
    }
  }

  // Exponential backoff: initialDelay * backoffFactor ^ (attempt - 1)
  const delay = config.initialDelay * Math.pow(config.backoffFactor, attempt - 1);
  // Add jitter (0-25% of delay) to avoid thundering herd
  const jitter = delay * 0.25 * Math.random();
  return Math.min(delay + jitter, config.maxDelay);
}

/**
 * Sleep for a given duration, respecting an abort signal.
 * Resolves false if aborted, true if completed.
 */
export function retrySleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      resolve(false);
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

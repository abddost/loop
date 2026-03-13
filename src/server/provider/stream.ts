import { streamText } from "ai"
import { DEFAULT_RETRY_CONFIG, type RetryConfig, withRetry } from "./retry"

export type StreamTextParams = Parameters<typeof streamText>[0]

/**
 * Wraps AI SDK's streamText with retry logic.
 * On retryable errors (429, 500, 502, 503), retries with exponential backoff.
 * Since streamText is synchronous and returns a result object, this function
 * wraps it in a promise to integrate with the retry mechanism.
 *
 * @param params - AI SDK streamText parameters
 * @param signal - AbortSignal for cancellation
 * @param config - Retry configuration (defaults to DEFAULT_RETRY_CONFIG)
 * @param onRetry - Optional callback for retry events
 * @returns StreamTextResult from AI SDK
 * @throws The last error after all retries are exhausted, or AbortError if cancelled
 */
export function streamWithRetry(
	params: StreamTextParams,
	signal: AbortSignal,
	config: RetryConfig = DEFAULT_RETRY_CONFIG,
	onRetry?: (attempt: number, error: Error, delayMs: number) => void,
) {
	return withRetry(
		async () => streamText({ ...params, abortSignal: signal }),
		signal,
		config,
		onRetry,
	)
}

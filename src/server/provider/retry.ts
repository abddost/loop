import { isRetryable } from "@core/error"
import { sleep } from "@core/util/async"

export interface RetryConfig {
	/** Maximum number of retry attempts. Default: 3 */
	maxRetries: number
	/** Base delay in ms. Default: 1000 */
	baseDelay: number
	/** Maximum delay in ms. Default: 30000 */
	maxDelay: number
	/** Jitter factor (0-1). Default: 0.2 */
	jitterFactor: number
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	baseDelay: 1000,
	maxDelay: 30_000,
	jitterFactor: 0.2,
}

/**
 * Calculate backoff delay with exponential backoff + jitter.
 * Honors Retry-After and Retry-After-Ms headers when present.
 *
 * @param attempt - The current retry attempt number (zero-based)
 * @param config - Retry configuration for backoff calculation
 * @param headers - Optional HTTP headers that may contain Retry-After values
 * @returns The delay in milliseconds before the next retry
 */
export function calculateDelay(attempt: number, config: RetryConfig, headers?: Headers): number {
	// Check for Retry-After-Ms header first (milliseconds)
	const retryAfterMs = headers?.get("retry-after-ms")
	if (retryAfterMs) {
		const ms = Number.parseInt(retryAfterMs, 10)
		if (!Number.isNaN(ms) && ms > 0) return ms
	}

	// Check for Retry-After header (seconds)
	const retryAfter = headers?.get("retry-after")
	if (retryAfter) {
		const seconds = Number.parseInt(retryAfter, 10)
		if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000
	}

	// Exponential backoff with jitter
	const exponential = Math.min(config.baseDelay * 2 ** attempt, config.maxDelay)
	const jitter = exponential * config.jitterFactor * Math.random()
	return exponential + jitter
}

/**
 * Execute an async function with retry logic.
 * Uses exponential backoff with jitter, honors Retry-After headers,
 * and is abort-safe (rejects immediately on signal abort).
 *
 * @param fn - The async function to execute and potentially retry
 * @param signal - AbortSignal for cancellation
 * @param config - Retry configuration (defaults to DEFAULT_RETRY_CONFIG)
 * @param onRetry - Optional callback fired before each retry attempt
 * @returns The resolved value from fn
 * @throws The last error after all retries are exhausted, or AbortError if cancelled
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	signal: AbortSignal,
	config: RetryConfig = DEFAULT_RETRY_CONFIG,
	onRetry?: (attempt: number, error: Error, delayMs: number) => void,
): Promise<T> {
	let lastError: Error | undefined

	for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
		try {
			if (signal.aborted) {
				throw new DOMException("Aborted", "AbortError")
			}
			return await fn()
		} catch (error) {
			lastError = error as Error

			// Don't retry abort errors
			if (error instanceof DOMException && error.name === "AbortError") throw error

			// Don't retry non-retryable errors
			if (!isRetryable(error)) throw error

			// Don't retry if we've exhausted attempts
			if (attempt >= config.maxRetries) throw error

			// Calculate delay and sleep (abort-safe via signal)
			const headers = (error as any).headers ?? (error as any).response?.headers
			const delay = calculateDelay(attempt, config, headers)
			onRetry?.(attempt + 1, lastError, delay)
			await sleep(delay, signal)
		}
	}

	throw lastError!
}

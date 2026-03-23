import { isContextOverflow } from "@core/error"

// ─── Constants ──────────────────────────────────────────────────
export const RETRY_INITIAL_DELAY = 2000
export const RETRY_BACKOFF_FACTOR = 2
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000
export const RETRY_MAX_DELAY = 2_147_483_647 // max setTimeout

// ─── Abortable sleep ────────────────────────────────────────────

/**
 * Sleep that rejects with AbortError when the signal fires.
 * Unlike the generic `sleep` in `@core/util/async`, this always
 * requires a signal — retry loops must be cancellable.
 */
export function retrySleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
			return
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort)
			resolve()
		}, ms)
		function onAbort() {
			clearTimeout(timer)
			reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
		}
		signal.addEventListener("abort", onAbort, { once: true })
	})
}

// ─── Delay calculation ──────────────────────────────────────────

/**
 * Compute the retry delay for a given attempt.
 *
 * Priority:
 *   1. `retry-after-ms` header (milliseconds)
 *   2. `retry-after` header (seconds or HTTP-date)
 *   3. Exponential backoff: RETRY_INITIAL_DELAY * RETRY_BACKOFF_FACTOR^attempt
 *
 * When headers provide a delay, cap at RETRY_MAX_DELAY (max setTimeout).
 * When falling back to exponential backoff, cap at RETRY_MAX_DELAY_NO_HEADERS.
 */
export function retryDelay(attempt: number, responseHeaders?: Record<string, string>): number {
	if (responseHeaders) {
		// 1. Retry-After-Ms (milliseconds — non-standard but used by Anthropic/OpenAI)
		const retryAfterMs = responseHeaders["retry-after-ms"]
		if (retryAfterMs) {
			const ms = Number.parseInt(retryAfterMs, 10)
			if (!Number.isNaN(ms) && ms > 0) {
				return Math.min(ms, RETRY_MAX_DELAY)
			}
		}

		// 2. Retry-After (seconds or HTTP-date — RFC 7231)
		const retryAfter = responseHeaders["retry-after"]
		if (retryAfter) {
			const seconds = Number.parseInt(retryAfter, 10)
			if (!Number.isNaN(seconds) && seconds > 0) {
				return Math.min(seconds * 1000, RETRY_MAX_DELAY)
			}
			// Try HTTP-date (e.g. "Fri, 31 Dec 2027 23:59:59 GMT")
			const date = Date.parse(retryAfter)
			if (!Number.isNaN(date)) {
				const ms = date - Date.now()
				return ms > 0 ? Math.min(ms, RETRY_MAX_DELAY) : RETRY_INITIAL_DELAY
			}
		}
	}

	// 3. Exponential backoff (no header guidance)
	const delay = RETRY_INITIAL_DELAY * RETRY_BACKOFF_FACTOR ** attempt
	return Math.min(delay, RETRY_MAX_DELAY_NO_HEADERS)
}

// ─── Error classification ───────────────────────────────────────

type RetryClassification =
	| { type: "retryable"; message: string }
	| { type: "context_overflow" }
	| { type: "fatal" }

/** Patterns that indicate context/token overflow. */
const CONTEXT_OVERFLOW_RE =
	/context|too many tokens|max.*token|content_too_large|request_too_large/i

/** Patterns that indicate a retryable server/rate issue. */
const RETRYABLE_MESSAGE_RE = /overloaded|too_many_requests|rate_limit|exhausted|unavailable/i

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503])

/**
 * Classify an error for the retry loop.
 *
 * Returns one of:
 *   - `{ type: "retryable", message }` — retry with a human-readable reason
 *   - `{ type: "context_overflow" }` — trigger compaction instead of retry
 *   - `{ type: "fatal" }` — stop immediately
 */
export function classifyError(error: unknown): RetryClassification {
	// 1. Context overflow — delegate to core's detector first, then check our patterns
	if (isContextOverflow(error)) {
		return { type: "context_overflow" }
	}

	const status = extractStatus(error)
	const msg = String((error as any)?.message ?? "")

	// Additional context overflow checks (status 413, message patterns)
	if (status === 413 || CONTEXT_OVERFLOW_RE.test(msg)) {
		return { type: "context_overflow" }
	}

	// 2. Retryable — status codes
	if (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) {
		return {
			type: "retryable",
			message: status === 429 ? "Rate limited by provider" : `Server error (${status})`,
		}
	}

	// 3. Retryable — message patterns
	if (RETRYABLE_MESSAGE_RE.test(msg)) {
		return { type: "retryable", message: humanizeRetryReason(msg) }
	}

	// 4. Everything else is fatal
	return { type: "fatal" }
}

// ─── Helpers ────────────────────────────────────────────────────

/** Extract an HTTP status code from any error shape (AppError, AI SDK, fetch, etc). */
function extractStatus(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined
	const e = error as Record<string, any>
	const raw = e.statusCode ?? e.status ?? e.response?.status
	return typeof raw === "number" ? raw : undefined
}

/** Turn an error message into a short human-readable retry reason. */
function humanizeRetryReason(msg: string): string {
	const lower = msg.toLowerCase()
	if (lower.includes("overloaded")) return "Provider is overloaded"
	if (lower.includes("rate_limit") || lower.includes("too_many_requests"))
		return "Rate limited by provider"
	if (lower.includes("exhausted")) return "Provider quota exhausted"
	if (lower.includes("unavailable")) return "Provider temporarily unavailable"
	return "Transient provider error"
}

import { AppError, ValidationError } from "@core/error"
import type { ErrorHandler } from "hono"
import { createLogger } from "../logger"

const log = createLogger("server")

/**
 * Global error handler.
 * Catches all errors and returns appropriate HTTP responses
 * with structured error codes.
 *
 * Logging policy:
 * - Expected client errors (4xx AppError / ValidationError) → `warn`,
 *   message-only. These are routine — a stale URL pointing to a deleted
 *   session, a bad request payload, an auth failure. The status-line
 *   logger middleware already records the path + 4xx status, so we
 *   don't need a stack trace on top of it.
 * - Unexpected server errors (5xx, anything not an AppError) → `error`
 *   with the full error so we can debug.
 */
export const errorHandler: ErrorHandler = (err, c) => {
	const ctx = { path: c.req.path, method: c.req.method }

	if (err instanceof ValidationError) {
		log.warn("Request validation failed", { ...ctx, message: err.message })
		return c.json({ error: { code: "VALIDATION_ERROR", message: err.message } }, 400)
	}

	if (err instanceof AppError) {
		const status = err.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500
		if (status >= 500) {
			log.error("AppError 5xx", { ...ctx, code: err.code, error: err })
		} else {
			log.warn("AppError 4xx", { ...ctx, code: err.code, message: err.message })
		}
		return c.json({ error: { code: err.code, message: err.message } }, status)
	}

	log.error("Unhandled request error", { ...ctx, error: err })
	return c.json({ error: { code: "INTERNAL_ERROR", message: err.message } }, 500)
}

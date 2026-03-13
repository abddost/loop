import { AppError, ValidationError } from "@core/error"
import type { ErrorHandler } from "hono"

/**
 * Global error handler.
 * Catches all errors and returns appropriate HTTP responses
 * with structured error codes.
 */
export const errorHandler: ErrorHandler = (err, c) => {
	console.error("[server:error]", err)

	if (err instanceof ValidationError) {
		return c.json({ error: { code: "VALIDATION_ERROR", message: err.message } }, 400)
	}

	if (err instanceof AppError) {
		const status = err.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500
		return c.json({ error: { code: err.code, message: err.message } }, status)
	}

	return c.json({ error: { code: "INTERNAL_ERROR", message: err.message } }, 500)
}

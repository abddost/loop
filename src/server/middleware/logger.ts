import { createMiddleware } from "hono/factory"
import { createLogger } from "../logger"

const log = createLogger("http")

/** Structured request logger that logs method, path, status, and duration. */
export const loggerMiddleware = createMiddleware(async (c, next) => {
	const start = performance.now()
	await next()
	const durationMs = Math.round((performance.now() - start) * 10) / 10
	log.info("Request", {
		method: c.req.method,
		path: c.req.path,
		status: c.res.status,
		durationMs,
	})
})

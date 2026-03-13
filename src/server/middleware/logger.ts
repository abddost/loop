import { createMiddleware } from "hono/factory"

/** Simple request logger that logs method, path, status, and duration. */
export const loggerMiddleware = createMiddleware(async (c, next) => {
	const start = performance.now()
	await next()
	const ms = (performance.now() - start).toFixed(1)
	console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`)
})

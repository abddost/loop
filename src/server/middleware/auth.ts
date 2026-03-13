import { createMiddleware } from "hono/factory"
import { env } from "../env"

/**
 * Basic auth middleware.
 * Validates the token from Authorization header using Basic auth scheme.
 * Skips auth if no token is configured (dev mode).
 */
export const authMiddleware = createMiddleware(async (c, next) => {
	if (!env.authToken) return next()

	// EventSource API cannot send custom headers, so SSE endpoints
	// pass the token via query parameter instead.
	const queryToken = c.req.query("token")
	if (queryToken === env.authToken) return next()

	const auth = c.req.header("authorization")
	if (!auth) return c.json({ error: "Unauthorized" }, 401)

	const [scheme, encoded] = auth.split(" ")
	if (scheme !== "Basic" || !encoded) {
		return c.json({ error: "Invalid auth scheme" }, 401)
	}

	const decoded = atob(encoded)
	const [, token] = decoded.split(":")
	if (token !== env.authToken) return c.json({ error: "Invalid token" }, 401)

	await next()
})

import { timingSafeEqual } from "node:crypto"
import { createMiddleware } from "hono/factory"
import { env } from "../env"

/**
 * Constant-time string compare. Avoids `===` so a timing oracle cannot be
 * used to learn the expected token one character at a time. Strings of
 * different lengths return false without leaking which length was expected.
 */
function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a, "utf8")
	const bufB = Buffer.from(b, "utf8")
	if (bufA.length !== bufB.length) return false
	return timingSafeEqual(bufA, bufB)
}

/**
 * Basic auth middleware.
 * Validates the token from Authorization header using Basic auth scheme.
 * Skips auth if no token is configured (dev mode).
 */
export const authMiddleware = createMiddleware(async (c, next) => {
	if (!env.authToken) return next()

	// Health endpoint is unauthenticated (used for readiness probes)
	if (c.req.path === "/health") return next()

	// EventSource API cannot send custom headers, so SSE endpoints
	// pass the token via query parameter instead.
	const queryToken = c.req.query("token")
	if (queryToken && safeEqual(queryToken, env.authToken)) return next()

	const auth = c.req.header("authorization")
	if (!auth) return c.json({ error: "Unauthorized" }, 401)

	const [scheme, encoded] = auth.split(" ")
	if (scheme !== "Basic" || !encoded) {
		return c.json({ error: "Invalid auth scheme" }, 401)
	}

	let token: string | undefined
	try {
		const decoded = atob(encoded)
		token = decoded.split(":")[1]
	} catch {
		return c.json({ error: "Invalid auth encoding" }, 401)
	}
	if (!token || !safeEqual(token, env.authToken)) {
		return c.json({ error: "Invalid token" }, 401)
	}

	await next()
})

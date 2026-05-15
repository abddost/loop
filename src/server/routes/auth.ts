import { Hono } from "hono"
import { env } from "../env"
import { SESSION_COOKIE_NAME } from "../middleware/auth"

export const authRoutes = new Hono()

/**
 * POST /auth/session — mint the SSE cookie.
 *
 * EventSource can't carry a bearer header, so callers that need streaming
 * (the global event bus, terminal WebSockets) call this endpoint first.
 * The auth middleware has already validated the bearer header by the time
 * this handler runs; success here just stamps the same token into an
 * httpOnly cookie that subsequent same-origin / credentialed cross-origin
 * requests will send automatically.
 *
 * Why not a separate session ID? The bearer token is already short-lived
 * (it lives only for the current Electron process) and already validated
 * with constant-time compare in the middleware. Issuing a second secret
 * would force us to maintain server-side session state with no security
 * benefit — both would be equally compromised if the renderer were.
 *
 * Cookie attributes:
 *   - HttpOnly      — keeps the value out of `document.cookie`
 *   - SameSite=None — the renderer (loop:// or http://localhost:1420) is
 *                     cross-origin to the API (http://127.0.0.1:PORT), so a
 *                     stricter SameSite would block the cookie outright
 *   - Secure        — required alongside SameSite=None; Chromium grants the
 *                     localhost-Secure exception that lets this work over
 *                     plain HTTP loopback
 *   - Path=/        — every API route can read it
 *   - Max-Age omitted — the cookie is session-scoped; closing the renderer
 *                     drops it, matching the lifetime of LOOP_AUTH_TOKEN
 */
authRoutes.post("/auth/session", (c) => {
	const token = env.authToken
	if (!token) {
		return c.json({ error: "Server misconfigured" }, 503)
	}

	const attrs = [
		`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
		"Path=/",
		"HttpOnly",
		"SameSite=None",
		"Secure",
	]
	c.header("Set-Cookie", attrs.join("; "))
	return c.json({ ok: true })
})

/**
 * POST /auth/session/revoke — drop the cookie.
 *
 * The token itself stays valid (it's the process-wide bearer); this just
 * clears the convenience cookie so a renderer can force callers back to
 * the Authorization header path.
 */
authRoutes.post("/auth/session/revoke", (c) => {
	const attrs = [
		`${SESSION_COOKIE_NAME}=`,
		"Path=/",
		"HttpOnly",
		"SameSite=None",
		"Secure",
		"Max-Age=0",
	]
	c.header("Set-Cookie", attrs.join("; "))
	return c.json({ ok: true })
})

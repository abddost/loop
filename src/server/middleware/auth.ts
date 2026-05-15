import { timingSafeEqual } from "node:crypto"
import { createMiddleware } from "hono/factory"
import { env } from "../env"

/**
 * Cookie name used by the SSE handshake. Set by POST /auth/session and
 * accepted here in lieu of an Authorization header — EventSource cannot send
 * custom headers, so without a cookie the bearer token would have to ride in
 * the query string (where it leaks to logs and shell history).
 */
export const SESSION_COOKIE_NAME = "loop_session"

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
 * Parse a single cookie value out of the `Cookie` header without pulling in
 * a dependency. Cookies are `name=value; name2=value2`. Values may be
 * URL-encoded by the client; the bearer token is hex so encoding is a no-op
 * in practice, but we decode defensively.
 */
function readCookie(header: string | undefined, name: string): string | undefined {
	if (!header) return undefined
	for (const part of header.split(";")) {
		const eq = part.indexOf("=")
		if (eq === -1) continue
		const key = part.slice(0, eq).trim()
		if (key !== name) continue
		const raw = part.slice(eq + 1).trim()
		try {
			return decodeURIComponent(raw)
		} catch {
			return raw
		}
	}
	return undefined
}

/**
 * Loop only ever serves loopback clients. Reject anything that doesn't
 * declare a loopback host in the `Host` header — this defends against DNS
 * rebinding attacks (an attacker-controlled domain that resolves to
 * 127.0.0.1 would still arrive with `Host: attacker.com`).
 *
 * The same check on `Origin` blocks browser pages on arbitrary websites
 * from issuing authenticated requests even if they somehow obtain the token.
 */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

function hostnameOf(value: string): string {
	// Strip scheme if present (Origin includes it; Host does not).
	const noScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
	// Strip path (Origin should not have one; defense in depth).
	const noPath = noScheme.split("/")[0] ?? ""
	// Strip port. IPv6 addresses are bracketed: [::1]:1234 → [::1]
	if (noPath.startsWith("[")) {
		const end = noPath.indexOf("]")
		return end === -1 ? noPath : noPath.slice(0, end + 1)
	}
	const colon = noPath.lastIndexOf(":")
	return colon === -1 ? noPath : noPath.slice(0, colon)
}

function isLoopbackHost(value: string | undefined | null): boolean {
	if (!value) return false
	return LOOPBACK_HOSTNAMES.has(hostnameOf(value).toLowerCase())
}

/**
 * Custom-scheme origins used by the Electron renderer. These never appear
 * with a `Host` of `attacker.com` — they're issued by our own preload, not
 * by a hostile webpage — so we whitelist them explicitly.
 */
function isTrustedAppOrigin(origin: string): boolean {
	return origin.startsWith("loop://") || origin.startsWith("tauri://")
}

export const authMiddleware = createMiddleware(async (c, next) => {
	const path = c.req.path

	// Health is unauthenticated for readiness probes from the desktop shell.
	if (path === "/health") return next()

	// ── 1. Token presence ────────────────────────────────────────────────
	//
	// Dev mode tolerates an empty token so `bun dev` can run without the
	// Electron shell. In production a missing token means the shell failed
	// to wire up the secret — fail closed rather than expose the API.
	if (!env.authToken) {
		if (env.isDev) return next()
		return c.json({ error: "Server misconfigured: auth token unset" }, 503)
	}

	// ── 2. Host / Origin guard (DNS-rebinding defense) ───────────────────
	//
	// We bind to 127.0.0.1, but a browser that resolved a hostile name to
	// our loopback IP would still reach us. Reject anything that doesn't
	// look like a local caller.
	const hostHeader = c.req.header("host")
	if (hostHeader && !isLoopbackHost(hostHeader)) {
		return c.json({ error: "Forbidden host" }, 403)
	}

	const origin = c.req.header("origin")
	if (origin && !isTrustedAppOrigin(origin) && !isLoopbackHost(origin)) {
		return c.json({ error: "Forbidden origin" }, 403)
	}

	// ── 3. Token validation ──────────────────────────────────────────────
	//
	// Accept (in order): session cookie, Authorization header. The legacy
	// `?token=` query parameter is intentionally not honored — callers that
	// can't send headers (EventSource) should mint a cookie via
	// POST /auth/session first.
	const cookieToken = readCookie(c.req.header("cookie"), SESSION_COOKIE_NAME)
	if (cookieToken && safeEqual(cookieToken, env.authToken)) return next()

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

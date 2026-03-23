import type { OAuthAuth } from "@core/schema/provider"

// ─── Types ──────────────────────────────────────────────────────

export type { OAuthAuth }

export type AuthResult =
	| {
			type: "success"
			accessToken: string
			refreshToken: string
			expiresAt: number
			accountId?: string
	  }
	| { type: "pending" }
	| { type: "failed"; error: string }

// ─── PKCE Utilities ─────────────────────────────────────────────

/**
 * Generate a random code verifier for PKCE (43-128 chars).
 */
export function generateCodeVerifier(length = 43): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
	const bytes = crypto.getRandomValues(new Uint8Array(length))
	return Array.from(bytes, (b) => chars[b % chars.length]).join("")
}

/**
 * Generate a SHA-256 code challenge from a code verifier (S256 method).
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
	const data = new TextEncoder().encode(verifier)
	const hash = await crypto.subtle.digest("SHA-256", data)
	return base64UrlEncode(hash)
}

/**
 * Generate a random state parameter for CSRF protection.
 */
export function generateState(): string {
	return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer)
}

/**
 * Base64url encode an ArrayBuffer (no padding).
 */
export function base64UrlEncode(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer)
	const binary = String.fromCharCode(...bytes)
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// ─── Token Helpers ──────────────────────────────────────────────

/**
 * Parse JWT claims from an id_token or access_token.
 */
export function parseJwtClaims(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".")
	if (parts.length !== 3) return undefined
	try {
		return JSON.parse(Buffer.from(parts[1], "base64url").toString())
	} catch {
		return undefined
	}
}

/**
 * Convert an AuthResult success to our stored OAuthAuth format.
 */
export function toOAuthAuth(result: Extract<AuthResult, { type: "success" }>): OAuthAuth {
	return {
		type: "oauth",
		accessToken: result.accessToken,
		refreshToken: result.refreshToken,
		expiresAt: result.expiresAt,
		accountId: result.accountId,
	}
}

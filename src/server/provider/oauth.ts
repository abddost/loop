import type { OAuthAuth } from "@core/schema/provider"

// ─── Types ──────────────────────────────────────────────────────

export interface OAuthMethod {
	providerId: string
	label: string
	authorize(inputs?: Record<string, string>): Promise<OAuthAuthorization>
}

export interface OAuthAuthorization {
	url: string
	userCode?: string
	method: "device-code" | "redirect"
	instructions: string
	/** Poll until the user completes authorization. */
	poll(): Promise<OAuthResult>
}

export type OAuthResult =
	| { type: "success"; accessToken: string; refreshToken: string; expiresAt: number }
	| { type: "pending" }
	| { type: "failed"; error: string }

// ─── GitHub Copilot Device Code Flow ────────────────────────────

const GITHUB_CLIENT_ID = "Ov23li8tweQw6odWQebz"
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
const POLLING_SAFETY_MARGIN_MS = 3_000

async function authorizeGitHubCopilot(): Promise<OAuthAuthorization> {
	const response = await fetch(GITHUB_DEVICE_CODE_URL, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			client_id: GITHUB_CLIENT_ID,
			scope: "read:user",
		}),
	})

	if (!response.ok) {
		throw new Error(`GitHub device code request failed: ${response.status}`)
	}

	const data = (await response.json()) as {
		verification_uri: string
		user_code: string
		device_code: string
		interval: number
		expires_in: number
	}

	let pollInterval = data.interval

	return {
		url: data.verification_uri,
		userCode: data.user_code,
		method: "device-code",
		instructions: `Go to ${data.verification_uri} and enter code: ${data.user_code}`,
		async poll(): Promise<OAuthResult> {
			const res = await fetch(GITHUB_ACCESS_TOKEN_URL, {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					client_id: GITHUB_CLIENT_ID,
					device_code: data.device_code,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				}),
			})

			const result = (await res.json()) as {
				access_token?: string
				error?: string
				interval?: number
			}

			if (result.access_token) {
				return {
					type: "success",
					accessToken: result.access_token,
					refreshToken: result.access_token, // GitHub uses same token
					expiresAt: 0, // GitHub tokens don't expire
				}
			}

			if (result.error === "slow_down") {
				// RFC 8628: increase interval by 5 seconds
				pollInterval = result.interval ?? pollInterval + 5
				return { type: "pending" }
			}

			if (result.error === "authorization_pending") {
				return { type: "pending" }
			}

			if (result.error === "expired_token") {
				return { type: "failed", error: "Device code expired. Please try again." }
			}

			if (result.error) {
				return { type: "failed", error: result.error }
			}

			return { type: "pending" }
		},
	}
}

/**
 * Create a custom fetch function that injects GitHub Copilot OAuth headers.
 */
export function createCopilotFetch(getToken: () => string): typeof fetch {
	const copilotFetch = (input: any, init?: any) => {
		const headers = new Headers(init?.headers as HeadersInit | undefined)
		headers.set("Authorization", `Bearer ${getToken()}`)
		headers.set("Openai-Intent", "conversation-edits")
		headers.delete("x-api-key")
		return fetch(input, { ...init, headers })
	}
	return copilotFetch as typeof fetch
}

// ─── OAuth Method Registry ──────────────────────────────────────

/**
 * Registry of available OAuth methods, keyed by provider ID.
 */
export const OAUTH_METHODS: Record<string, OAuthMethod> = {
	"github-copilot": {
		providerId: "github-copilot",
		label: "Sign in with GitHub",
		authorize: authorizeGitHubCopilot,
	},
}

/**
 * Get the poll interval for a provider's device code flow.
 * Returns milliseconds.
 */
export function getPollIntervalMs(_providerId: string): number {
	// Default 5 seconds + safety margin
	return 5_000 + POLLING_SAFETY_MARGIN_MS
}

/**
 * Convert an OAuthResult to our stored OAuthAuth format.
 */
export function toOAuthAuth(result: Extract<OAuthResult, { type: "success" }>): OAuthAuth {
	return {
		type: "oauth",
		accessToken: result.accessToken,
		refreshToken: result.refreshToken,
		expiresAt: result.expiresAt,
	}
}

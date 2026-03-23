import type { OAuthAuth } from "@core/schema/provider"
import { createLogger } from "../../logger"
import type { AuthAuthorization, AuthHandler, AuthResult } from "../auth-handler"

const log = createLogger("auth:copilot")

const CLIENT_ID = "Ov23li8tweQw6odWQebz"

function normalizeDomain(url: string): string {
	return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function getUrls(domain: string) {
	return {
		deviceCode: `https://${domain}/login/device/code`,
		accessToken: `https://${domain}/login/oauth/access_token`,
	}
}

// ─── Handler ────────────────────────────────────────────────────

export const copilotHandler: AuthHandler = {
	providerId: "github-copilot",

	methods: [
		{
			id: "oauth-device",
			type: "oauth",
			label: "Sign in with GitHub",
			description: "Authenticate via GitHub device code flow",
			prompts: [
				{
					type: "select",
					key: "instance",
					label: "GitHub instance",
					options: [
						{ label: "GitHub.com", value: "public", hint: "Public" },
						{ label: "GitHub Enterprise", value: "enterprise", hint: "Self-hosted" },
					],
				},
				{
					type: "text",
					key: "enterpriseUrl",
					label: "Enterprise URL",
					placeholder: "github.example.com",
					when: { key: "instance", op: "eq", value: "enterprise" },
				},
			],
		},
	],

	async authorize(_methodId, inputs = {}): Promise<AuthAuthorization> {
		const instance = inputs.instance ?? "public"
		const domain =
			instance === "enterprise" && inputs.enterpriseUrl
				? normalizeDomain(inputs.enterpriseUrl)
				: "github.com"

		const urls = getUrls(domain)

		const response = await fetch(urls.deviceCode, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				client_id: CLIENT_ID,
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
			method: "auto",
			instructions: `Go to ${data.verification_uri} and enter code: ${data.user_code}`,
			async poll(): Promise<AuthResult> {
				const res = await fetch(urls.accessToken, {
					method: "POST",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						client_id: CLIENT_ID,
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
	},

	createFetch(
		getAuth: () => Promise<OAuthAuth | undefined>,
		_setAuth: (auth: OAuthAuth) => Promise<void>,
	): typeof fetch {
		const copilotFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			const auth = await getAuth()
			if (!auth) return fetch(input, init)

			const headers = new Headers(init?.headers as HeadersInit | undefined)
			headers.set("Authorization", `Bearer ${auth.refreshToken}`)
			headers.set("Openai-Intent", "conversation-edits")
			headers.delete("x-api-key")

			log.debug("Copilot fetch with token injection")

			return fetch(input, { ...init, headers })
		}
		return copilotFetch as typeof fetch
	},
}

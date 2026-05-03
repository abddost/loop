import type { OAuthAuth } from "@core/schema/provider"
import { PROMPT_CODEX } from "../../agent/prompt/templates/codex"
import { createLogger } from "../../logger"
import type { AuthAuthorization, AuthHandler, AuthResult } from "../auth-handler"
import {
	generateCodeChallenge,
	generateCodeVerifier,
	generateState,
	parseJwtClaims,
} from "../oauth"

const log = createLogger("auth:codex")

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"

/**
 * Port the OpenAI Codex client_id is registered against. Must match exactly —
 * OpenAI rejects any other localhost port for this client. We spawn an
 * ephemeral HTTP server on this port for the OAuth callback, separate from
 * Loop's main app server.
 */
const OAUTH_PORT = 1455
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_PORT}/auth/callback`

export const OAUTH_DUMMY_KEY = "loop-oauth-codex-dummy"

/** Parameters the Codex endpoint rejects — stripped from the request body. */
const CODEX_STRIP_PARAMS = [
	"max_output_tokens",
	"temperature",
	"top_p",
	"conversation",
	"max_tool_calls",
	"parallel_tool_calls",
	"previous_response_id",
	"user",
	"service_tier",
	"include",
	"prompt_cache_key",
	"prompt_cache_retention",
	"safety_identifier",
	"top_logprobs",
	"truncation",
	"metadata",
	"reasoning_effort",
]

/**
 * Models allowed when using Codex with a ChatGPT subscription (OAuth).
 * Any model with "codex" in its ID is also allowed.
 */
const CODEX_ALLOWED_MODELS = new Set([
	"gpt-5.1-codex",
	"gpt-5.1-codex-max",
	"gpt-5.1-codex-mini",
	"gpt-5.2",
	"gpt-5.2-codex",
	"gpt-5.3-codex",
	"gpt-5.4",
	"gpt-5.4-mini",
])

/** Check if a model is supported by the Codex endpoint. */
export function isCodexModel(modelId: string): boolean {
	return modelId.includes("codex") || CODEX_ALLOWED_MODELS.has(modelId)
}

// ─── Token Helpers ──────────────────────────────────────────────

interface TokenResponse {
	id_token: string
	access_token: string
	refresh_token: string
	expires_in?: number
}

async function exchangeCodeForTokens(
	code: string,
	redirectUri: string,
	codeVerifier: string,
): Promise<TokenResponse> {
	const response = await fetch(`${ISSUER}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: CLIENT_ID,
			code_verifier: codeVerifier,
		}).toString(),
	})
	if (!response.ok) {
		throw new Error(`Token exchange failed: ${response.status}`)
	}
	return response.json()
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
	const response = await fetch(`${ISSUER}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}).toString(),
	})
	if (!response.ok) {
		throw new Error(`Token refresh failed: ${response.status}`)
	}
	return response.json()
}

function extractAccountId(tokens: TokenResponse): string | undefined {
	for (const tokenStr of [tokens.id_token, tokens.access_token]) {
		if (!tokenStr) continue
		const claims = parseJwtClaims(tokenStr)
		if (!claims) continue

		const accountId =
			(claims.chatgpt_account_id as string) ??
			(claims as Record<string, Record<string, string>>)["https://api.openai.com/auth"]
				?.chatgpt_account_id ??
			(claims.organizations as Array<{ id: string }> | undefined)?.[0]?.id

		if (accountId) return accountId
	}
	return undefined
}

// ─── Browser PKCE Callback State ────────────────────────────────

const HTML_SUCCESS = `<!doctype html>
<html><head><title>Loop - Authorization Successful</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#131010;color:#f1ecec}.container{text-align:center;padding:2rem}h1{margin-bottom:1rem}p{color:#b7b1b1}</style>
</head><body><div class="container"><h1>Authorization Successful</h1><p>You can close this window and return to Loop.</p></div>
<script>setTimeout(()=>window.close(),2000)</script></body></html>`

const HTML_ERROR = (error: string) => `<!doctype html>
<html><head><title>Loop - Authorization Failed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#131010;color:#f1ecec}.container{text-align:center;padding:2rem}h1{color:#fc533a;margin-bottom:1rem}p{color:#b7b1b1}.error{color:#ff917b;font-family:monospace;margin-top:1rem;padding:1rem;background:#3c140d;border-radius:.5rem}</style>
</head><body><div class="container"><h1>Authorization Failed</h1><p>An error occurred during authorization.</p><div class="error">${error}</div></div></body></html>`

interface PendingOAuth {
	codeVerifier: string
	state: string
	redirectUri: string
	resolve: (tokens: TokenResponse) => void
	reject: (error: Error) => void
}

let pendingOAuth: PendingOAuth | undefined
let oauthServer: ReturnType<typeof Bun.serve> | undefined

/**
 * Start a one-shot HTTP server on OAUTH_PORT to receive the browser
 * redirect from auth.openai.com. The OpenAI Codex client_id is registered
 * with this exact port + path, so the main Loop server (on a different
 * port) cannot serve it. Idempotent — returns the same redirect URI if a
 * server is already running.
 */
function startOAuthServer(): { redirectUri: string } {
	if (oauthServer) return { redirectUri: OAUTH_REDIRECT_URI }

	try {
		oauthServer = Bun.serve({
			port: OAUTH_PORT,
			hostname: "127.0.0.1",
			fetch(req) {
				const url = new URL(req.url)
				if (url.pathname === "/auth/callback") {
					const response = handleOAuthCallback(url)
					queueMicrotask(stopOAuthServer)
					return response
				}
				return new Response("Not found", { status: 404 })
			},
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		if (
			message.includes("EADDRINUSE") ||
			message.toLowerCase().includes("address already in use")
		) {
			throw new Error(
				`Port ${OAUTH_PORT} is already in use. Another Loop or Codex CLI auth flow may be running. Close it and retry (e.g. \`lsof -ti:${OAUTH_PORT} | xargs kill\`).`,
			)
		}
		throw err
	}

	log.info("OAuth callback server started", { port: OAUTH_PORT })
	return { redirectUri: OAUTH_REDIRECT_URI }
}

function stopOAuthServer(): void {
	if (!oauthServer) return
	oauthServer.stop(true)
	oauthServer = undefined
	log.info("OAuth callback server stopped")
}

/**
 * Handle the OAuth callback from the browser PKCE flow.
 * Called from the ephemeral OAuth server's fetch handler when the browser
 * redirects to /auth/callback after the user signs in.
 */
function handleOAuthCallback(url: URL): Response {
	const code = url.searchParams.get("code")
	const state = url.searchParams.get("state")
	const error = url.searchParams.get("error")
	const errorDescription = url.searchParams.get("error_description")

	if (error) {
		const msg = errorDescription || error
		pendingOAuth?.reject(new Error(msg))
		pendingOAuth = undefined
		return new Response(HTML_ERROR(msg), { headers: { "Content-Type": "text/html" } })
	}

	if (!code) {
		const msg = "Missing authorization code"
		pendingOAuth?.reject(new Error(msg))
		pendingOAuth = undefined
		return new Response(HTML_ERROR(msg), {
			status: 400,
			headers: { "Content-Type": "text/html" },
		})
	}

	if (!pendingOAuth || state !== pendingOAuth.state) {
		const msg = "Invalid state — potential CSRF attack"
		pendingOAuth?.reject(new Error(msg))
		pendingOAuth = undefined
		return new Response(HTML_ERROR(msg), {
			status: 400,
			headers: { "Content-Type": "text/html" },
		})
	}

	const current = pendingOAuth
	pendingOAuth = undefined

	exchangeCodeForTokens(code, current.redirectUri, current.codeVerifier)
		.then((tokens) => current.resolve(tokens))
		.catch((err) => current.reject(err))

	return new Response(HTML_SUCCESS, { headers: { "Content-Type": "text/html" } })
}

function waitForOAuthCallback(
	codeVerifier: string,
	state: string,
	redirectUri: string,
): Promise<TokenResponse> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => {
				if (pendingOAuth) {
					pendingOAuth = undefined
					stopOAuthServer()
					reject(new Error("OAuth callback timeout — authorization took too long"))
				}
			},
			5 * 60 * 1000,
		)

		pendingOAuth = {
			codeVerifier,
			state,
			redirectUri,
			resolve: (tokens) => {
				clearTimeout(timeout)
				resolve(tokens)
			},
			reject: (error) => {
				clearTimeout(timeout)
				reject(error)
			},
		}
	})
}

// ─── Handler ────────────────────────────────────────────────────

export const codexHandler: AuthHandler = {
	providerId: "openai",

	methods: [
		{
			id: "oauth-browser",
			type: "oauth",
			label: "ChatGPT Pro/Plus (browser)",
			description: "Sign in via browser — requires an active ChatGPT subscription",
			prompts: [],
		},
		{
			id: "oauth-device",
			type: "oauth",
			label: "ChatGPT Pro/Plus (headless)",
			description: "Sign in via device code — for environments without a browser",
			prompts: [],
		},
		{
			id: "api-key",
			type: "api-key",
			label: "OpenAI API Key",
			description: "Enter your OpenAI API key directly",
			prompts: [],
		},
	],

	async authorize(methodId, _inputs = {}): Promise<AuthAuthorization> {
		if (methodId === "oauth-browser") {
			return authorizeBrowser()
		}
		if (methodId === "oauth-device") {
			return authorizeDevice()
		}
		// api-key method — not an OAuth flow, handled by frontend directly
		throw new Error(`Method "${methodId}" does not require OAuth authorization`)
	},

	createFetch(
		getAuth: () => Promise<OAuthAuth | undefined>,
		setAuth: (auth: OAuthAuth) => Promise<void>,
	): typeof fetch | undefined {
		const codexFetch = async (requestInput: RequestInfo | URL, init?: RequestInit) => {
			const currentAuth = await getAuth()
			if (!currentAuth) return fetch(requestInput, init)

			// Remove any dummy API key header
			if (init?.headers) {
				const h = init.headers
				if (h instanceof Headers) {
					h.delete("authorization")
					h.delete("Authorization")
				} else if (Array.isArray(h)) {
					init.headers = h.filter(([key]) => key.toLowerCase() !== "authorization")
				} else {
					const rec = h as Record<string, string | undefined>
					rec.authorization = undefined
					rec.Authorization = undefined
				}
			}

			// Check if token needs refresh
			let accessToken = currentAuth.accessToken
			if (!accessToken || (currentAuth.expiresAt > 0 && currentAuth.expiresAt < Date.now())) {
				log.info("Refreshing Codex access token")
				try {
					const tokens = await refreshAccessToken(currentAuth.refreshToken)
					const newAccountId = extractAccountId(tokens) || currentAuth.accountId
					const updated: OAuthAuth = {
						type: "oauth",
						refreshToken: tokens.refresh_token,
						accessToken: tokens.access_token,
						expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
						accountId: newAccountId,
					}
					await setAuth(updated)
					accessToken = tokens.access_token
				} catch (err) {
					log.error("Token refresh failed", { error: err })
					return fetch(requestInput, init)
				}
			}

			// Build headers
			const headers = new Headers()
			if (init?.headers) {
				if (init.headers instanceof Headers) {
					init.headers.forEach((value, key) => headers.set(key, value))
				} else if (Array.isArray(init.headers)) {
					for (const [key, value] of init.headers) {
						if (value !== undefined) headers.set(key, String(value))
					}
				} else {
					for (const [key, value] of Object.entries(init.headers)) {
						if (value !== undefined) headers.set(key, String(value))
					}
				}
			}

			headers.set("authorization", `Bearer ${accessToken}`)

			if (currentAuth.accountId) {
				headers.set("ChatGPT-Account-Id", currentAuth.accountId)
			}

			// Rewrite URL to Codex endpoint
			const parsed =
				requestInput instanceof URL
					? requestInput
					: new URL(typeof requestInput === "string" ? requestInput : requestInput.url)
			const isResponsesApi =
				parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
			const url = isResponsesApi ? new URL(CODEX_API_ENDPOINT) : parsed

			// Codex endpoint requires specific body fields — patch before sending
			let body = init?.body
			if (isResponsesApi && body && typeof body === "string") {
				try {
					const json = JSON.parse(body)
					// Extract system/developer messages from input → instructions
					if (!json.instructions && Array.isArray(json.input)) {
						const systemParts: string[] = []
						json.input = json.input.filter((msg: { role?: string; content?: unknown }) => {
							if (msg.role === "system" || msg.role === "developer") {
								if (typeof msg.content === "string") {
									systemParts.push(msg.content)
								}
								return false
							}
							return true
						})
						json.instructions = systemParts.join("\n\n") || PROMPT_CODEX
					}
					// Extract reasoning effort before stripping (SDK serializes as reasoning_effort)
					const effort = json.reasoning_effort ?? "medium"

					// Codex requires store=false and rejects unsupported params
					json.store = false
					for (const key of CODEX_STRIP_PARAMS) {
						if (key in json) json[key] = undefined
					}

					// Inject Codex-format reasoning object
					const { read } = await import("../../config")
					const summary = read().reasoning?.summary ?? "auto"
					json.reasoning = { effort, summary }

					body = JSON.stringify(json)
				} catch {
					// Not JSON or parse error — send as-is
				}
			}

			return fetch(url, { ...init, body, headers })
		}
		return codexFetch as typeof fetch
	},
}

// ─── Browser PKCE Flow ──────────────────────────────────────────

async function authorizeBrowser(): Promise<AuthAuthorization> {
	const { redirectUri } = startOAuthServer()

	const codeVerifier = generateCodeVerifier()
	const challenge = await generateCodeChallenge(codeVerifier)
	const state = generateState()

	const params = new URLSearchParams({
		response_type: "code",
		client_id: CLIENT_ID,
		redirect_uri: redirectUri,
		scope: "openid profile email offline_access",
		code_challenge: challenge,
		code_challenge_method: "S256",
		id_token_add_organizations: "true",
		codex_cli_simplified_flow: "true",
		state,
		originator: "loop",
	})

	const authUrl = `${ISSUER}/oauth/authorize?${params.toString()}`
	const callbackPromise = waitForOAuthCallback(codeVerifier, state, redirectUri)

	return {
		url: authUrl,
		method: "auto",
		instructions: "Complete authorization in your browser. This window will close automatically.",
		async poll(): Promise<AuthResult> {
			try {
				const tokens = await callbackPromise
				return {
					type: "success",
					refreshToken: tokens.refresh_token,
					accessToken: tokens.access_token,
					expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
					accountId: extractAccountId(tokens),
				}
			} catch (err) {
				stopOAuthServer()
				return {
					type: "failed",
					error: err instanceof Error ? err.message : "Authorization failed",
				}
			}
		},
	}
}

// ─── Device Code Flow ───────────────────────────────────────────

async function authorizeDevice(): Promise<AuthAuthorization> {
	const deviceResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client_id: CLIENT_ID }),
	})

	if (!deviceResponse.ok) {
		const body = await deviceResponse.text().catch(() => "")
		throw new Error(
			`Device authorization failed (${deviceResponse.status}): ${body || deviceResponse.statusText}`,
		)
	}

	const deviceData = (await deviceResponse.json()) as {
		device_auth_id: string
		user_code: string
		interval: string
	}
	return {
		url: `${ISSUER}/codex/device`,
		userCode: deviceData.user_code,
		method: "auto",
		instructions: `Enter code: ${deviceData.user_code}`,
		async poll(): Promise<AuthResult> {
			const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					device_auth_id: deviceData.device_auth_id,
					user_code: deviceData.user_code,
				}),
			})

			if (response.ok) {
				const data = (await response.json()) as {
					authorization_code: string
					code_verifier: string
				}

				const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						grant_type: "authorization_code",
						code: data.authorization_code,
						redirect_uri: `${ISSUER}/deviceauth/callback`,
						client_id: CLIENT_ID,
						code_verifier: data.code_verifier,
					}).toString(),
				})

				if (!tokenResponse.ok) {
					return { type: "failed", error: `Token exchange failed: ${tokenResponse.status}` }
				}

				const tokens: TokenResponse = await tokenResponse.json()
				return {
					type: "success",
					refreshToken: tokens.refresh_token,
					accessToken: tokens.access_token,
					expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
					accountId: extractAccountId(tokens),
				}
			}

			if (response.status === 403 || response.status === 404) {
				return { type: "pending" }
			}

			return { type: "failed", error: `Unexpected response: ${response.status}` }
		},
	}
}

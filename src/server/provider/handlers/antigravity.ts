import type { OAuthAuth } from "@core/schema/provider"
import type { LanguageModel } from "ai"
import { createLogger } from "../../logger"
import type { AuthAuthorization, AuthHandler, AuthResult } from "../auth-handler"
import type { ModelInfo, ProviderConfig, ProviderCredentials } from "../base"
import { generateCodeChallenge, generateCodeVerifier, generateState } from "../oauth"
import { createLanguageModel } from "../sdk"

const log = createLogger("auth:antigravity")

// ─── OAuth Constants ────────────────────────────────────────────

const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
const CLIENT_SECRET = "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"
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const REDIRECT_URI = "http://localhost:51121/oauth-callback"

const SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
]

// ─── API Endpoints ──────────────────────────────────────────────

/** Antigravity API endpoints in fallback order (daily → autopush → prod). */
const API_ENDPOINTS = [
	"https://daily-cloudcode-pa.sandbox.googleapis.com",
	"https://autopush-cloudcode-pa.sandbox.googleapis.com",
	"https://cloudcode-pa.googleapis.com",
] as const

/** Endpoints for project discovery (prod first, more reliable). */
const LOAD_ENDPOINTS = [
	"https://cloudcode-pa.googleapis.com",
	"https://daily-cloudcode-pa.sandbox.googleapis.com",
	"https://autopush-cloudcode-pa.sandbox.googleapis.com",
] as const

const ANTIGRAVITY_VERSION = "1.15.8"

/** Stable session ID for the lifetime of this server process. */
const SESSION_ID = crypto.randomUUID()

// ─── Token Helpers ──────────────────────────────────────────────

interface TokenResponse {
	access_token: string
	expires_in: number
	refresh_token?: string
}

async function exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			code,
			grant_type: "authorization_code",
			redirect_uri: REDIRECT_URI,
			code_verifier: codeVerifier,
		}),
	})
	if (!response.ok) {
		const text = await response.text()
		throw new Error(`Token exchange failed (${response.status}): ${text}`)
	}
	return response.json()
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
		}),
	})
	if (!response.ok) {
		const text = await response.text()
		throw new Error(`Token refresh failed (${response.status}): ${text}`)
	}
	return response.json()
}

// ─── Project Discovery ─────────────────────────────────────────

/**
 * Allow manual override via env var when automatic project resolution fails.
 * Users can set this to their own GCP project ID with cloudaicompanion API enabled.
 */
const ENV_PROJECT_ID = process.env.ANTIGRAVITY_PROJECT_ID

/** Legacy default project ID — revoked by Google but still useful as a hint for loadCodeAssist. */
const FALLBACK_PROJECT_HINT = "rising-fact-p41fc"

function buildMetadata(projectId?: string): Record<string, string> {
	// Note: `platform` is omitted from the body — the protobuf enum
	// rejects string values. Platform info is sent via the Client-Metadata header instead.
	const meta: Record<string, string> = {
		ideType: "ANTIGRAVITY",
		pluginType: "GEMINI",
	}
	if (projectId) meta.duetProject = projectId
	return meta
}

/** Headers matching the original plugin's loadCodeAssist calls exactly. */
function buildDiscoveryHeaders(accessToken: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${accessToken}`,
		"User-Agent": "google-api-nodejs-client/9.15.1",
		"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
		"Client-Metadata": getAntigravityHeaders()["Client-Metadata"],
	}
}

interface AntigravityTier {
	id?: string
	isDefault?: boolean
}

interface LoadCodeAssistResult {
	projectId?: string
	allowedTiers?: AntigravityTier[]
}

/** Extract managed project ID from loadCodeAssist response. */
function extractProjectId(data: Record<string, unknown>): string | undefined {
	// loadCodeAssist uses flat format: { cloudaicompanionProject: string | { id } }
	const project = data.cloudaicompanionProject
	if (typeof project === "string" && project) return project
	if (project && typeof (project as Record<string, string>).id === "string") {
		return (project as Record<string, string>).id
	}
	return undefined
}

/** Pick the default tier from allowed tiers (prefers isDefault, then first). */
function getDefaultTierId(tiers?: AntigravityTier[]): string | undefined {
	if (!tiers?.length) return undefined
	for (const t of tiers) {
		if (t.isDefault && t.id) return t.id
	}
	return tiers[0]?.id
}

/**
 * Call loadCodeAssist to discover the user's managed project and allowed tiers.
 * Passes the legacy default project as a hint (duetProject) — the API uses
 * this to locate the user's actual managed project even though the hint itself is revoked.
 */
async function loadCodeAssist(
	accessToken: string,
	projectHint?: string,
): Promise<LoadCodeAssistResult> {
	const headers = buildDiscoveryHeaders(accessToken)
	const body = JSON.stringify({ metadata: buildMetadata(projectHint) })

	for (const endpoint of LOAD_ENDPOINTS) {
		try {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 10_000)
			const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
				method: "POST",
				headers,
				body,
				signal: controller.signal,
			})
			clearTimeout(timeout)

			if (!response.ok) {
				const errBody = await response.text().catch(() => "")
				log.debug("loadCodeAssist endpoint failed", {
					endpoint,
					status: response.status,
					body: errBody.slice(0, 500),
				})
				continue
			}

			const data = (await response.json()) as Record<string, unknown>
			log.debug("loadCodeAssist response", {
				endpoint,
				hasProject: !!data.cloudaicompanionProject,
				hasTiers: !!(data.allowedTiers as unknown[])?.length,
			})
			return {
				projectId: extractProjectId(data),
				allowedTiers: data.allowedTiers as AntigravityTier[] | undefined,
			}
		} catch {
			log.debug("loadCodeAssist endpoint unreachable", { endpoint })
		}
	}
	return {}
}

/**
 * Onboard the user to provision a managed project.
 * Matches the original plugin: per-endpoint retries, break on failure.
 */
async function onboardUser(
	accessToken: string,
	tierId = "FREE",
	projectHint?: string,
	attempts = 10,
	delayMs = 5000,
): Promise<string | undefined> {
	const headers = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${accessToken}`,
		...getAntigravityHeaders(),
	}
	const body = JSON.stringify({
		tierId,
		metadata: buildMetadata(projectHint),
	})

	for (const endpoint of LOAD_ENDPOINTS) {
		for (let attempt = 0; attempt < attempts; attempt++) {
			try {
				const controller = new AbortController()
				const timeout = setTimeout(() => controller.abort(), 10_000)
				const response = await fetch(`${endpoint}/v1internal:onboardUser`, {
					method: "POST",
					headers,
					body,
					signal: controller.signal,
				})
				clearTimeout(timeout)

				if (!response.ok) {
					const errBody = await response.text().catch(() => "")
					log.debug("onboardUser endpoint failed", {
						endpoint,
						status: response.status,
						attempt,
						body: errBody.slice(0, 500),
					})
					break // This endpoint failed — try next one
				}

				const data = (await response.json()) as {
					done?: boolean
					response?: { cloudaicompanionProject?: { id?: string } }
				}
				log.debug("onboardUser response", { endpoint, done: data.done, attempt })
				if (data.done && data.response?.cloudaicompanionProject?.id) {
					return data.response.cloudaicompanionProject.id
				}
				if (data.done && projectHint) return projectHint
			} catch {
				log.debug("onboardUser endpoint unreachable", { endpoint })
				break // Network error — try next endpoint
			}

			if (attempt < attempts - 1) {
				await new Promise((r) => setTimeout(r, delayMs))
			}
		}
	}
	return undefined
}

/**
 * Discover the user's Antigravity project ID.
 *
 * Resolution order:
 * 1. ANTIGRAVITY_PROJECT_ID env var (manual override)
 * 2. loadCodeAssist API (returns user's managed project)
 * 3. onboardUser API (provisions a new managed project)
 * 4. Throws — no synthetic fallback (synthetic IDs aren't real GCP projects)
 */
async function fetchProjectId(accessToken: string): Promise<string> {
	// Step 0: Manual override via env var
	if (ENV_PROJECT_ID) {
		log.info("Using ANTIGRAVITY_PROJECT_ID from environment", { projectId: ENV_PROJECT_ID })
		return ENV_PROJECT_ID
	}

	// Step 1: Try loadCodeAssist (without hint first, then with legacy hint)
	const loaded = await loadCodeAssist(accessToken)
	if (loaded.projectId) {
		log.info("loadCodeAssist resolved project", { projectId: loaded.projectId })
		return loaded.projectId
	}
	const loadedWithHint = await loadCodeAssist(accessToken, FALLBACK_PROJECT_HINT)
	if (loadedWithHint.projectId) {
		log.info("loadCodeAssist resolved project (with hint)", {
			projectId: loadedWithHint.projectId,
		})
		return loadedWithHint.projectId
	}

	// Step 2: Auto-provision via onboardUser
	const tierId =
		getDefaultTierId(loaded.allowedTiers) ?? getDefaultTierId(loadedWithHint.allowedTiers) ?? "FREE"
	log.info("loadCodeAssist returned no project, attempting onboardUser", { tierId })
	const onboarded = await onboardUser(accessToken, tierId)
	if (onboarded) {
		log.info("onboardUser succeeded", { projectId: onboarded })
		return onboarded
	}

	// Step 3: No project available
	throw new Error(
		"Could not resolve Antigravity project ID. " +
			"Set ANTIGRAVITY_PROJECT_ID env var to your GCP project with " +
			"cloudaicompanion.googleapis.com API enabled.",
	)
}

// ─── Callback Server ───────────────────────────────────────────

const HTML_SUCCESS = `<!doctype html>
<html><head><title>Loop - Antigravity Connected</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#131010;color:#f1ecec}.container{text-align:center;padding:2rem}h1{margin-bottom:1rem}p{color:#b7b1b1}</style>
</head><body><div class="container"><h1>Antigravity Connected</h1><p>You can close this window and return to Loop.</p></div>
<script>setTimeout(()=>window.close(),2000)</script></body></html>`

const HTML_ERROR = (error: string) => `<!doctype html>
<html><head><title>Loop - Connection Failed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#131010;color:#f1ecec}.container{text-align:center;padding:2rem}h1{color:#fc533a;margin-bottom:1rem}p{color:#b7b1b1}.error{color:#ff917b;font-family:monospace;margin-top:1rem;padding:1rem;background:#3c140d;border-radius:.5rem}</style>
</head><body><div class="container"><h1>Connection Failed</h1><p>Could not connect to Antigravity.</p><div class="error">${error}</div></div></body></html>`

interface CallbackResult {
	accessToken: string
	refreshToken: string
	expiresAt: number
	projectId: string
}

/**
 * Start a temporary HTTP server on port 51121 to receive the Google OAuth callback.
 * The port and path are hardcoded in the Antigravity OAuth client registration.
 */
function startCallbackServer(codeVerifier: string, expectedState: string): Promise<CallbackResult> {
	return new Promise((resolve, reject) => {
		let server: ReturnType<typeof Bun.serve> | undefined
		let settled = false

		const settle = (fn: () => void) => {
			if (settled) return
			settled = true
			fn()
			// Defer server close to let the HTML response flush
			setTimeout(() => server?.stop(), 500)
		}

		const timeout = setTimeout(
			() => {
				settle(() => reject(new Error("OAuth callback timeout — authorization took too long")))
			},
			5 * 60 * 1000,
		)

		try {
			server = Bun.serve({
				port: 51121,
				hostname: "127.0.0.1",
				fetch: async (req) => {
					const url = new URL(req.url)
					if (url.pathname !== "/oauth-callback") {
						return new Response("Not found", { status: 404 })
					}

					const error = url.searchParams.get("error")
					if (error) {
						const msg = url.searchParams.get("error_description") || error
						clearTimeout(timeout)
						settle(() => reject(new Error(msg)))
						return new Response(HTML_ERROR(msg), {
							headers: { "Content-Type": "text/html" },
						})
					}

					const code = url.searchParams.get("code")
					if (!code) {
						const msg = "Missing authorization code"
						clearTimeout(timeout)
						settle(() => reject(new Error(msg)))
						return new Response(HTML_ERROR(msg), {
							status: 400,
							headers: { "Content-Type": "text/html" },
						})
					}

					// Validate CSRF state
					const state = url.searchParams.get("state")
					if (state !== expectedState) {
						const msg = "Invalid state parameter — potential CSRF"
						clearTimeout(timeout)
						settle(() => reject(new Error(msg)))
						return new Response(HTML_ERROR(msg), {
							status: 400,
							headers: { "Content-Type": "text/html" },
						})
					}

					clearTimeout(timeout)

					try {
						const tokens = await exchangeCode(code, codeVerifier)
						if (!tokens.refresh_token) {
							settle(() => reject(new Error("Missing refresh token in response")))
							return new Response(HTML_ERROR("Missing refresh token"), {
								headers: { "Content-Type": "text/html" },
							})
						}

						const projectId = await fetchProjectId(tokens.access_token)
						settle(() =>
							resolve({
								accessToken: tokens.access_token,
								refreshToken: tokens.refresh_token!,
								expiresAt: Date.now() + tokens.expires_in * 1000,
								projectId,
							}),
						)
						return new Response(HTML_SUCCESS, {
							headers: { "Content-Type": "text/html" },
						})
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err)
						settle(() => reject(err instanceof Error ? err : new Error(msg)))
						return new Response(HTML_ERROR(msg), {
							headers: { "Content-Type": "text/html" },
						})
					}
				},
			})
		} catch (err) {
			clearTimeout(timeout)
			reject(
				new Error(
					`Could not start callback server on port 51121: ${err instanceof Error ? err.message : String(err)}`,
				),
			)
		}
	})
}

// ─── Request/Response Transformation ────────────────────────────

function getAntigravityHeaders(): Record<string, string> {
	const platform =
		process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MAC_OS" : "LINUX"
	return {
		"User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/${ANTIGRAVITY_VERSION} Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36`,
		"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
		"Client-Metadata": JSON.stringify({ ideType: "ANTIGRAVITY", platform, pluginType: "GEMINI" }),
	}
}

/**
 * Inject thinking configuration for models that support extended thinking.
 * Claude thinking models use `include_thoughts` + `thinking_budget`.
 * Gemini 3 models use `includeThoughts` + `thinkingLevel`.
 * Gemini 2.5 models use `includeThoughts` + `thinkingBudget`.
 */
function injectThinkingConfig(body: Record<string, unknown>, model: string): void {
	const lower = model.toLowerCase()
	const genConfig = (body.generationConfig || {}) as Record<string, unknown>
	const currentMaxOutput = genConfig.maxOutputTokens as number | undefined

	if (lower.includes("claude") && lower.includes("thinking")) {
		const thinkingBudget = 32768
		// Skip thinking for short generations (e.g., title generation with maxOutputTokens: 80)
		// where the output budget is too small to justify thinking overhead
		if (currentMaxOutput && currentMaxOutput < thinkingBudget) {
			return
		}
		genConfig.thinkingConfig = { include_thoughts: true, thinking_budget: thinkingBudget }
		// max_tokens must exceed thinking.budget_tokens — default SDK value (8192) is too low
		if (!currentMaxOutput || currentMaxOutput <= thinkingBudget) {
			genConfig.maxOutputTokens = 64000
		}
		body.generationConfig = genConfig
	} else if (lower.includes("gemini-3")) {
		genConfig.thinkingConfig = { includeThoughts: true, thinkingLevel: "low" }
		body.generationConfig = genConfig
	} else if (lower.includes("gemini-2.5")) {
		genConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: 16384 }
		body.generationConfig = genConfig
	}
}

/**
 * Sanitize request payload for Claude models routed through Antigravity.
 *
 * Claude (via Vertex) has constraints that differ from Gemini:
 * 1. No assistant/model message prefill — conversation must end with a user message
 * 2. Empty text/reasoning parts are rejected
 *
 * The @ai-sdk/google SDK may add a trailing "model" role message for response
 * guidance (prefill), which Gemini supports but Claude does not.
 */
function sanitizeForClaude(body: Record<string, unknown>): void {
	const contents = body.contents as Array<{ role?: string; parts?: unknown[] }> | undefined
	if (!contents?.length) return

	// Strip trailing "model" entries — Claude requires ending with "user"
	while (contents.length > 0 && contents[contents.length - 1]?.role === "model") {
		contents.pop()
	}

	// Filter out empty text parts (Claude rejects empty strings)
	for (const entry of contents) {
		if (!entry.parts) continue
		entry.parts = entry.parts.filter((part) => {
			if (part && typeof part === "object" && "text" in part) {
				return (part as { text: string }).text !== ""
			}
			return true
		})
	}

	// Remove entries that became empty after filtering
	body.contents = contents.filter((entry) => entry.parts && entry.parts.length > 0)
}

/**
 * Ensure all tool function declarations have a `parameters` object.
 * Antigravity converts Google's `functionDeclarations` to Claude's tool format,
 * mapping `parameters` → `input_schema`. Claude requires `input_schema` on every
 * tool — declarations without `parameters` cause a validation error.
 */
function ensureToolSchemas(body: Record<string, unknown>): void {
	const tools = body.tools as
		| Array<{ functionDeclarations?: Array<Record<string, unknown>> }>
		| undefined
	if (!tools) return
	for (const tool of tools) {
		if (!tool.functionDeclarations) continue
		for (const fn of tool.functionDeclarations) {
			if (!fn.parameters) {
				fn.parameters = { type: "object", properties: {} }
			}
		}
	}
}

/**
 * Unwrap the Antigravity SSE response envelope.
 * Antigravity wraps each SSE event: `data: {"response": {...}, "traceId": "..."}`
 * The Google AI SDK expects bare inner: `data: {"candidates": [...], ...}`
 */
function createUnwrapStream(): TransformStream<Uint8Array, Uint8Array> {
	const decoder = new TextDecoder()
	const encoder = new TextEncoder()
	let buffer = ""

	return new TransformStream({
		transform(chunk, controller) {
			buffer += decoder.decode(chunk, { stream: true })

			for (let idx = buffer.indexOf("\n\n"); idx !== -1; idx = buffer.indexOf("\n\n")) {
				const event = buffer.slice(0, idx)
				buffer = buffer.slice(idx + 2)

				if (event.startsWith("data: ")) {
					const jsonStr = event.slice(6).trim()
					if (jsonStr === "[DONE]") {
						controller.enqueue(encoder.encode("data: [DONE]\n\n"))
						continue
					}
					try {
						const parsed = JSON.parse(jsonStr) as Record<string, unknown>
						const inner = (parsed.response ?? parsed) as Record<string, unknown>
						controller.enqueue(encoder.encode(`data: ${JSON.stringify(inner)}\n\n`))
					} catch {
						controller.enqueue(encoder.encode(`${event}\n\n`))
					}
				} else {
					controller.enqueue(encoder.encode(`${event}\n\n`))
				}
			}
		},
		flush(controller) {
			if (buffer.trim()) {
				if (buffer.startsWith("data: ")) {
					const jsonStr = buffer.slice(6).trim()
					try {
						const parsed = JSON.parse(jsonStr) as Record<string, unknown>
						const inner = (parsed.response ?? parsed) as Record<string, unknown>
						controller.enqueue(encoder.encode(`data: ${JSON.stringify(inner)}\n\n`))
					} catch {
						controller.enqueue(encoder.encode(buffer))
					}
				} else {
					controller.enqueue(encoder.encode(buffer))
				}
			}
		},
	})
}

// ─── Models ─────────────────────────────────────────────────────

function model(id: string, name: string, opts: Partial<ModelInfo> = {}): ModelInfo {
	return {
		id,
		name,
		providerId: "antigravity",
		supportsImages: true,
		supportsTools: true,
		supportsReasoning: false,
		supportsTemperature: true,
		contextWindow: 200_000,
		maxOutput: 8192,
		pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		status: "active" as const,
		modalities: { input: ["text", "image"], output: ["text"] },
		...opts,
	}
}

const GEMINI_OPTS: Partial<ModelInfo> = {
	supportsReasoning: true,
	contextWindow: 1_000_000,
	maxOutput: 65536,
}

const CLAUDE_THINKING_OPTS: Partial<ModelInfo> = {
	supportsReasoning: true,
	maxOutput: 64_000,
}

/** Fallback model list used when discovery is unavailable. */
const FALLBACK_MODELS: ModelInfo[] = [
	// Claude models
	model("claude-sonnet-4-5", "Claude Sonnet 4.5", { maxOutput: 64_000 }),
	model("claude-sonnet-4-5-thinking", "Claude Sonnet 4.5 (Thinking)", CLAUDE_THINKING_OPTS),
	model("claude-opus-4-5-thinking", "Claude Opus 4.5 (Thinking)", CLAUDE_THINKING_OPTS),
	model("claude-opus-4-6-thinking", "Claude Opus 4.6 (Thinking)", CLAUDE_THINKING_OPTS),
	// Gemini 3
	model("gemini-3-pro", "Gemini 3 Pro", GEMINI_OPTS),
	model("gemini-3-flash", "Gemini 3 Flash", GEMINI_OPTS),
	// Gemini 2.5
	model("gemini-2.5-pro", "Gemini 2.5 Pro", GEMINI_OPTS),
	model("gemini-2.5-flash", "Gemini 2.5 Flash", GEMINI_OPTS),
]

/**
 * Discover available Antigravity models by probing the API.
 * Tries to list models via the Google AI endpoint, falls back to static list.
 */
export async function discoverAntigravityModels(accessToken?: string): Promise<ModelInfo[]> {
	if (!accessToken) return FALLBACK_MODELS

	for (const endpoint of API_ENDPOINTS) {
		try {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 10_000)
			const response = await fetch(`${endpoint}/v1beta/models`, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					...getAntigravityHeaders(),
				},
				signal: controller.signal,
			})
			clearTimeout(timeout)

			if (!response.ok) continue

			const data = (await response.json()) as {
				models?: Array<{
					name?: string
					displayName?: string
					inputTokenLimit?: number
					outputTokenLimit?: number
				}>
			}
			if (!data.models?.length) continue

			const discovered: ModelInfo[] = []
			for (const m of data.models) {
				if (!m.name) continue
				// name is like "models/gemini-3-pro" — strip prefix
				const id = m.name.replace(/^models\//, "")
				const isThinking =
					id.includes("thinking") || id.includes("gemini-3") || id.includes("gemini-2.5")
				discovered.push(
					model(id, m.displayName || id, {
						contextWindow: m.inputTokenLimit,
						maxOutput: m.outputTokenLimit,
						supportsReasoning: isThinking,
					}),
				)
			}

			if (discovered.length > 0) {
				log.info("Discovered antigravity models", { count: discovered.length })
				return discovered
			}
		} catch {
			// Endpoint unavailable, try next
		}
	}

	log.debug("Model discovery unavailable, using fallback list")
	return FALLBACK_MODELS
}

export function isAntigravityModel(modelId: string): boolean {
	return antigravityProvider.models.some((m) => m.id === modelId)
}

// ─── Provider Config ────────────────────────────────────────────

export const antigravityProvider: ProviderConfig = {
	id: "antigravity",
	name: "Antigravity",
	description: "Antigravity editor subscription — Claude & Gemini models",
	npm: "@ai-sdk/google",
	auth: { methods: ["oauth"], envKeys: [] },
	models: FALLBACK_MODELS,
	createModel(modelId: string, credentials: ProviderCredentials): LanguageModel {
		return createLanguageModel("@ai-sdk/google", modelId, credentials, "antigravity")
	},
}

// ─── Auth Handler ───────────────────────────────────────────────

export const antigravityHandler: AuthHandler = {
	providerId: "antigravity",

	methods: [
		{
			id: "oauth-browser",
			type: "oauth",
			label: "Sign in with Google",
			description: "Authenticate via Google to access Antigravity subscription models",
			prompts: [],
		},
	],

	async authorize(_methodId, _inputs = {}): Promise<AuthAuthorization> {
		const codeVerifier = generateCodeVerifier()
		const challenge = await generateCodeChallenge(codeVerifier)
		const state = generateState()

		const params = new URLSearchParams({
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: REDIRECT_URI,
			scope: SCOPES.join(" "),
			code_challenge: challenge,
			code_challenge_method: "S256",
			state,
			access_type: "offline",
			prompt: "consent",
		})

		const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`
		const callbackPromise = startCallbackServer(codeVerifier, state)

		return {
			url: authUrl,
			method: "auto",
			instructions: "Sign in with your Google account to connect Antigravity.",
			async poll(): Promise<AuthResult> {
				try {
					const result = await callbackPromise
					return {
						type: "success",
						accessToken: result.accessToken,
						refreshToken: result.refreshToken,
						expiresAt: result.expiresAt,
						accountId: result.projectId,
					}
				} catch (err) {
					return {
						type: "failed",
						error: err instanceof Error ? err.message : "Authorization failed",
					}
				}
			},
		}
	},

	createFetch(
		getAuth: () => Promise<OAuthAuth | undefined>,
		setAuth: (auth: OAuthAuth) => Promise<void>,
	): typeof fetch {
		// Cache the resolved project ID to avoid re-resolving on every request.
		// Invalidated on 403 CONSUMER_INVALID to trigger re-resolution.
		let cachedProjectId: string | undefined

		const ensureAccessToken = async (
			auth: OAuthAuth,
		): Promise<{ accessToken: string; auth: OAuthAuth }> => {
			if (auth.expiresAt > 0 && Date.now() >= auth.expiresAt - 60_000) {
				log.info("Refreshing Antigravity access token")
				const tokens = await refreshAccessToken(auth.refreshToken)
				const updated: OAuthAuth = {
					type: "oauth",
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token || auth.refreshToken,
					expiresAt: Date.now() + tokens.expires_in * 1000,
					accountId: auth.accountId,
				}
				await setAuth(updated)
				return { accessToken: tokens.access_token, auth: updated }
			}
			return { accessToken: auth.accessToken, auth }
		}

		const resolveProjectId = async (
			accessToken: string,
			currentAuth: OAuthAuth,
		): Promise<string> => {
			if (cachedProjectId) return cachedProjectId

			// Use stored accountId if available
			if (currentAuth.accountId) {
				cachedProjectId = currentAuth.accountId
				return cachedProjectId
			}

			// Re-resolve from API
			const projectId = await fetchProjectId(accessToken)
			cachedProjectId = projectId

			// Persist for future sessions
			await setAuth({ ...currentAuth, accountId: projectId })
			return projectId
		}

		const sendRequest = async (
			accessToken: string,
			projectId: string,
			rawModel: string,
			action: string,
			isStreaming: boolean,
			init?: RequestInit,
		): Promise<Response> => {
			// Parse and transform the request body
			let wrappedBody: string | undefined
			if (init?.body && typeof init.body === "string") {
				try {
					const requestPayload = JSON.parse(init.body) as Record<string, unknown>
					injectThinkingConfig(requestPayload, rawModel)
					ensureToolSchemas(requestPayload)
					if (rawModel.includes("claude")) sanitizeForClaude(requestPayload)
					requestPayload.sessionId = `${SESSION_ID}:${rawModel}:${projectId}`
					wrappedBody = JSON.stringify({
						project: projectId,
						model: rawModel,
						request: requestPayload,
						requestType: "agent",
						userAgent: "antigravity",
						requestId: `agent-${crypto.randomUUID()}`,
					})
				} catch {
					wrappedBody = init.body
				}
			}

			// Build Antigravity headers
			const headers = new Headers()
			for (const [key, value] of Object.entries(getAntigravityHeaders())) {
				headers.set(key, value)
			}
			headers.set("Authorization", `Bearer ${accessToken}`)
			headers.set("Content-Type", "application/json")
			if (isStreaming) headers.set("Accept", "text/event-stream")

			// Try all endpoints with fallback
			let response: Response | undefined
			let lastError: Error | undefined

			for (const endpoint of API_ENDPOINTS) {
				const epUrl = `${endpoint}/v1internal:${action}${isStreaming ? "?alt=sse" : ""}`
				try {
					response = await fetch(epUrl, {
						method: "POST",
						headers,
						body: wrappedBody ?? init?.body,
						signal: init?.signal,
					})
					if (response.ok) break
					log.warn("Antigravity endpoint returned error, trying next", {
						endpoint,
						status: response.status,
					})
				} catch (err) {
					lastError = err instanceof Error ? err : new Error(String(err))
					if (lastError.name === "AbortError") throw lastError
					log.warn("Antigravity endpoint unreachable, trying next", {
						endpoint,
						error: lastError.message,
					})
				}
			}

			if (!response) throw lastError || new Error("All Antigravity endpoints failed")
			return response
		}

		const antigravityFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			const auth = await getAuth()
			if (!auth) return fetch(input, init)

			// Parse original URL to extract model and action
			const url =
				input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url)
			const modelMatch = url.pathname.match(/\/models\/([^:]+):(\w+)/)
			if (!modelMatch) {
				const headers = new Headers(init?.headers as HeadersInit | undefined)
				headers.set("Authorization", `Bearer ${auth.accessToken}`)
				return fetch(input, { ...init, headers })
			}

			const [, rawModel, action] = modelMatch
			const isStreaming = action === "streamGenerateContent"

			const { accessToken, auth: currentAuth } = await ensureAccessToken(auth)
			const projectId = await resolveProjectId(accessToken, currentAuth)

			log.debug("Antigravity request", {
				model: rawModel,
				action,
				streaming: isStreaming,
				projectId,
			})

			let response = await sendRequest(accessToken, projectId, rawModel, action, isStreaming, init)

			// On 403 CONSUMER_INVALID, re-resolve project ID and retry once
			if (response.status === 403) {
				const body = await response.text()
				if (body.includes("CONSUMER_INVALID")) {
					log.info("Project invalid, re-resolving project ID", { oldProject: projectId })
					cachedProjectId = undefined
					const freshAuth = (await getAuth()) ?? currentAuth
					// Clear stale accountId so resolveProjectId hits the API
					await setAuth({ ...freshAuth, accountId: "" })
					const newProjectId = await fetchProjectId(accessToken)
					cachedProjectId = newProjectId
					await setAuth({ ...freshAuth, accountId: newProjectId })

					log.info("Retrying with new project ID", { newProject: newProjectId })
					response = await sendRequest(
						accessToken,
						newProjectId,
						rawModel,
						action,
						isStreaming,
						init,
					)
				} else {
					// Return the 403 as-is for non-project errors
					return new Response(body, {
						status: response.status,
						statusText: response.statusText,
						headers: response.headers,
					})
				}
			}

			if (!response.ok) {
				log.error("All Antigravity endpoints returned error", {
					model: rawModel,
					status: response.status,
					projectId: cachedProjectId,
				})
				return response
			}

			// Unwrap streaming SSE response
			if (isStreaming && response.body) {
				const unwrapped = response.body.pipeThrough(createUnwrapStream())
				return new Response(unwrapped, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				})
			}

			// Unwrap non-streaming response
			try {
				const data = (await response.json()) as Record<string, unknown>
				const inner = (data.response ?? data) as Record<string, unknown>
				return new Response(JSON.stringify(inner), {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				})
			} catch {
				return response
			}
		}

		return antigravityFetch as typeof fetch
	},
}

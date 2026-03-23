import { Hono } from "hono"
import { z } from "zod"
import { AgentRegistry } from "../agent"
import * as Config from "../config"
import { createLogger } from "../logger"
import {
	ProviderRegistry,
	getAuthHandler,
	listAuthHandlers,
	refreshModelsDevCache,
	toOAuthAuth,
} from "../provider"
import type { AuthManager } from "../provider/auth"
import type { AuthAuthorization } from "../provider/auth-handler"
import { type CustomProviderSchema, resolveCustomProvider } from "../provider/custom"
import { handleOAuthCallback } from "../provider/handlers/codex"

const log = createLogger("provider-routes")

export const providerRoutes = new Hono()

/**
 * GET /auth/codex/callback — Browser redirect target for Codex PKCE OAuth flow.
 * OpenAI redirects here after the user authorizes in their browser.
 */
providerRoutes.get("/auth/codex/callback", (c) => {
	const url = new URL(c.req.url)
	return handleOAuthCallback(url)
})

/** Shared auth manager instance — set during server startup. */
let authManager: AuthManager | null = null

export function setAuthManager(auth: AuthManager): void {
	authManager = auth
}

// ─── Zod schemas for request validation ─────────────────────────

const SetAuthBodySchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("api-key"),
		key: z.string().min(1, "API key must not be empty"),
		baseUrl: z.string().url().optional(),
	}),
	z.object({
		type: z.literal("oauth"),
		accessToken: z.string().min(1),
		refreshToken: z.string().min(1),
		expiresAt: z.number(),
		accountId: z.string().optional(),
	}),
	z.object({
		type: z.literal("wellknown"),
		key: z.string().min(1),
		token: z.string().min(1),
	}),
])

const CustomProviderBodySchema = z.object({
	id: z
		.string()
		.min(1)
		.regex(/^[a-z0-9][a-z0-9_-]*$/, "ID must be lowercase alphanumeric with hyphens/underscores"),
	name: z.string().min(1),
	baseUrl: z.string().url(),
	apiKey: z.string().optional(),
	models: z
		.array(
			z.object({
				id: z.string().min(1),
				name: z.string().optional(),
				supportsImages: z.boolean().default(false),
				supportsTools: z.boolean().default(true),
				supportsReasoning: z.boolean().default(false),
				supportsTemperature: z.boolean().default(true),
				contextWindow: z.number().default(128_000),
				maxOutput: z.number().default(4_096),
			}),
		)
		.min(1, "At least one model is required"),
	headers: z.record(z.string(), z.string()).optional(),
})

// ─── Helper ─────────────────────────────────────────────────────

function requireAuth() {
	if (!authManager) {
		return { error: "Auth manager not initialized" as const }
	}
	return { auth: authManager }
}

// ─── Provider List / Details ────────────────────────────────────

/**
 * GET /providers — List all providers categorized as connected, popular, other.
 */
providerRoutes.get("/providers", async (c) => {
	return c.json(await ProviderRegistry.listCategorized())
})

/**
 * GET /providers/auth — List available auth methods for all providers.
 * Returns rich AuthMethodInfo[] per provider from registered handlers,
 * with fallback simple methods for non-handler providers.
 */
providerRoutes.get("/providers/auth", (c) => {
	const providers = ProviderRegistry.list()
	const handlerMap = new Map(listAuthHandlers().map((h) => [h.providerId, h]))

	const result: Record<
		string,
		Array<{ id: string; type: string; label: string; description?: string; prompts: unknown[] }>
	> = {}

	for (const provider of providers) {
		const handler = handlerMap.get(provider.id)
		if (handler) {
			result[provider.id] = handler.methods
		} else {
			result[provider.id] = provider.auth.methods.map((method) => ({
				id: method,
				type: method,
				label:
					method === "api-key"
						? `API Key${provider.auth.envKeys.length > 0 ? ` (${provider.auth.envKeys[0]})` : ""}`
						: "OAuth",
				prompts: [],
			}))
		}
	}

	return c.json(result)
})

/**
 * GET /providers/:id — Get a single provider's details.
 */
providerRoutes.get("/providers/:id", async (c) => {
	const id = c.req.param("id")
	const provider = ProviderRegistry.get(id)
	if (!provider) {
		return c.json({ error: "Provider not found" }, 404)
	}

	const categorized = await ProviderRegistry.listCategorized()
	const all = [...categorized.connected, ...categorized.popular, ...categorized.other]
	const info = all.find((p) => p.id === id)

	if (!info) {
		return c.json({ error: "Provider not found" }, 404)
	}

	return c.json({ ...info, source: provider.source })
})

/**
 * GET /providers/:id/models — List models for a specific provider.
 */
providerRoutes.get("/providers/:id/models", (c) => {
	const id = c.req.param("id")
	const provider = ProviderRegistry.get(id)
	if (!provider) {
		return c.json({ error: "Provider not found" }, 404)
	}

	return c.json(provider.models)
})

// ─── Auth Endpoints ─────────────────────────────────────────────

/**
 * PUT /providers/:id — Set API key for a provider (backward compatible).
 */
providerRoutes.put("/providers/:id", async (c) => {
	const id = c.req.param("id")
	const provider = ProviderRegistry.get(id)
	if (!provider) {
		return c.json({ error: "Provider not found" }, 404)
	}

	const result = requireAuth()
	if ("error" in result) return c.json({ error: result.error }, 500)

	const body = await c.req.json<{ apiKey: string; baseUrl?: string }>()
	if (!body.apiKey) {
		return c.json({ error: "apiKey is required" }, 400)
	}

	await result.auth.setApiKey(id, body.apiKey)
	if (body.baseUrl) {
		result.auth.setBaseUrl(id, body.baseUrl)
	}
	ProviderRegistry.invalidateProvider(id)

	return c.json({ ok: true, providerId: id })
})

/**
 * POST /providers/:id/auth — Set auth for a provider (unified endpoint).
 * Body: { type: "api-key", key, baseUrl? } | { type: "oauth", ... } | { type: "wellknown", key, token }
 */
providerRoutes.post("/providers/:id/auth", async (c) => {
	const id = c.req.param("id")
	const provider = ProviderRegistry.get(id)
	if (!provider) {
		return c.json({ error: "Provider not found" }, 404)
	}

	const result = requireAuth()
	if ("error" in result) return c.json({ error: result.error }, 500)

	const body = await c.req.json()
	const parsed = SetAuthBodySchema.safeParse(body)
	if (!parsed.success) {
		const messages = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
		return c.json({ error: `Invalid request body: ${messages.join("; ")}` }, 400)
	}

	const data = parsed.data
	switch (data.type) {
		case "api-key":
			await result.auth.setApiKey(id, data.key)
			if (data.baseUrl) {
				result.auth.setBaseUrl(id, data.baseUrl)
			}
			break
		case "oauth":
			await result.auth.setOAuthToken(id, {
				type: "oauth",
				accessToken: data.accessToken,
				refreshToken: data.refreshToken,
				expiresAt: data.expiresAt,
				accountId: data.accountId,
			})
			break
		case "wellknown":
			await result.auth.setWellKnownAuth(id, {
				type: "wellknown",
				key: data.key,
				token: data.token,
			})
			break
	}

	ProviderRegistry.invalidateProvider(id)
	return c.json({ ok: true, providerId: id, authType: data.type })
})

/**
 * DELETE /providers/:id/auth — Remove all auth for a provider.
 */
providerRoutes.delete("/providers/:id/auth", async (c) => {
	const id = c.req.param("id")

	const result = requireAuth()
	if ("error" in result) return c.json({ error: result.error }, 500)

	await result.auth.clearApiKey(id)
	result.auth.clearBaseUrl(id)
	await result.auth.clearOAuthToken(id)
	ProviderRegistry.invalidateProvider(id)

	return c.json({ ok: true, providerId: id })
})

/**
 * DELETE /providers/:id/key — Remove API key for a provider (backward compatible).
 */
providerRoutes.delete("/providers/:id/key", async (c) => {
	const id = c.req.param("id")

	const result = requireAuth()
	if ("error" in result) return c.json({ error: result.error }, 500)

	await result.auth.clearApiKey(id)
	result.auth.clearBaseUrl(id)
	ProviderRegistry.invalidateProvider(id)

	return c.json({ ok: true })
})

// ─── Custom Provider Management ─────────────────────────────────

/**
 * POST /providers/custom — Add a custom OpenAI-compatible provider.
 * Persists to config file and registers in the provider registry.
 */
providerRoutes.post("/providers/custom", async (c) => {
	const body = await c.req.json()
	const parsed = CustomProviderBodySchema.safeParse(body)
	if (!parsed.success) {
		const messages = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
		return c.json({ error: `Invalid request body: ${messages.join("; ")}` }, 400)
	}

	const data = parsed.data

	// Check for conflicts with existing built-in providers
	const existing = ProviderRegistry.get(data.id)
	if (existing && existing.source !== "custom") {
		return c.json({ error: `Provider ID "${data.id}" conflicts with a built-in provider` }, 409)
	}

	// Build the custom provider config for storage
	const customConfig: z.infer<typeof CustomProviderSchema> = {
		name: data.name,
		baseUrl: data.baseUrl,
		apiKey: data.apiKey,
		models: data.models,
		headers: data.headers,
	}

	// Save to config file under provider.<id>
	const config = Config.read()
	const providerSection = { ...(config.provider ?? {}) }
	providerSection[data.id] = {
		name: data.name,
		npm: "@ai-sdk/openai-compatible",
		api: data.baseUrl,
		options: data.apiKey ? { apiKey: data.apiKey } : undefined,
		headers: data.headers,
	}

	Config.write({ provider: providerSection })

	// Register in the provider registry
	const resolved = resolveCustomProvider(data.id, customConfig)
	ProviderRegistry.register(resolved)

	log.info("Custom provider registered", { id: data.id, name: data.name })

	return c.json({ ok: true, providerId: data.id }, 201)
})

/**
 * DELETE /providers/custom/:id — Remove a custom provider.
 * Removes from config file and unregisters from the provider registry.
 */
providerRoutes.delete("/providers/custom/:id", async (c) => {
	const id = c.req.param("id")

	const existing = ProviderRegistry.get(id)
	if (!existing) {
		return c.json({ error: "Provider not found" }, 404)
	}

	if (existing.source !== "custom") {
		return c.json({ error: `Provider "${id}" is not a custom provider and cannot be removed` }, 400)
	}

	// Remove from config file
	const config = Config.read()
	if (config.provider?.[id]) {
		const providerSection = { ...(config.provider ?? {}) }
		delete providerSection[id]
		Config.write({ provider: providerSection })
	}

	// Clear any stored auth
	const result = requireAuth()
	if (!("error" in result)) {
		await result.auth.clearApiKey(id)
		result.auth.clearBaseUrl(id)
	}

	// Unregister from the registry
	ProviderRegistry.unregister(id)

	log.info("Custom provider removed", { id })

	return c.json({ ok: true, providerId: id })
})

// ─── OAuth Flow ─────────────────────────────────────────────────

/** In-memory storage for pending OAuth authorizations. */
const pendingAuths = new Map<string, AuthAuthorization>()

/**
 * POST /providers/:id/oauth/authorize — Start OAuth flow via auth handler.
 * Body: { methodId: string, inputs?: Record<string, string> }
 */
providerRoutes.post("/providers/:id/oauth/authorize", async (c) => {
	const id = c.req.param("id")
	const handler = getAuthHandler(id)
	if (!handler) {
		return c.json({ error: `No auth handler available for provider "${id}"` }, 400)
	}

	try {
		const body = await c.req
			.json<{ methodId?: string; inputs?: Record<string, string> }>()
			.catch((): { methodId?: string; inputs?: Record<string, string> } => ({}))
		const methodId = body.methodId ?? handler.methods.find((m) => m.type === "oauth")?.id
		if (!methodId) {
			return c.json({ error: "No OAuth method found" }, 400)
		}

		const authorization = await handler.authorize(methodId, body.inputs)

		// Store for polling
		pendingAuths.set(id, authorization)

		return c.json({
			url: authorization.url,
			userCode: authorization.userCode,
			method: authorization.method,
			instructions: authorization.instructions,
		})
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Authorization failed"
		log.error("Authorization failed", { providerId: id, error: err })
		return c.json({ error: msg }, 500)
	}
})

/**
 * POST /providers/:id/oauth/callback — Poll/complete OAuth flow.
 */
providerRoutes.post("/providers/:id/oauth/callback", async (c) => {
	const id = c.req.param("id")

	const result = requireAuth()
	if ("error" in result) return c.json({ error: result.error }, 500)

	const authorization = pendingAuths.get(id)
	if (!authorization) {
		return c.json({ error: "No pending authorization. Call /oauth/authorize first." }, 400)
	}

	try {
		// Poll with timeout
		const maxPollTime = 5 * 60 * 1000 // 5 minutes
		const pollInterval = 8_000 // 5s + 3s safety margin
		const startTime = Date.now()

		while (Date.now() - startTime < maxPollTime) {
			const pollResult = await authorization.poll()

			if (pollResult.type === "success") {
				const oauthAuth = toOAuthAuth(pollResult)
				await result.auth.setOAuthToken(id, oauthAuth)
				ProviderRegistry.invalidateProvider(id)
				pendingAuths.delete(id)
				return c.json({ ok: true })
			}

			if (pollResult.type === "failed") {
				pendingAuths.delete(id)
				return c.json({ error: pollResult.error }, 400)
			}

			// result.type === "pending" — wait and retry
			await Bun.sleep(pollInterval)
		}

		pendingAuths.delete(id)
		return c.json({ error: "Authorization timed out" }, 408)
	} catch (err) {
		log.error("Callback failed", { providerId: id, error: err })
		pendingAuths.delete(id)
		return c.json({ error: "Authorization callback failed" }, 500)
	}
})

// ─── Refresh / Agents ───────────────────────────────────────────

/**
 * POST /providers/refresh — Trigger models.dev cache refresh.
 */
providerRoutes.post("/providers/refresh", async (c) => {
	await refreshModelsDevCache()
	return c.json({ ok: true })
})

/** GET /agents - List all visible agent definitions. */
providerRoutes.get("/agents", (c) => {
	return c.json(AgentRegistry.listVisible())
})

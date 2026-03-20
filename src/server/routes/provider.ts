import { Hono } from "hono"
import { AgentRegistry } from "../agent"
import { createLogger } from "../logger"
import {
	OAUTH_METHODS,
	ProviderRegistry,
	getPollIntervalMs,
	refreshModelsDevCache,
	toOAuthAuth,
} from "../provider"
import type { AuthManager } from "../provider/auth"

const log = createLogger("oauth")

export const providerRoutes = new Hono()

/** Shared auth manager instance — set during server startup. */
let authManager: AuthManager | null = null

export function setAuthManager(auth: AuthManager): void {
	authManager = auth
}

/**
 * GET /providers — List all providers categorized as connected, popular, other.
 */
providerRoutes.get("/providers", (c) => {
	return c.json(ProviderRegistry.listCategorized())
})

/**
 * GET /providers/:id — Get a single provider's details.
 */
providerRoutes.get("/providers/:id", (c) => {
	const id = c.req.param("id")
	const provider = ProviderRegistry.get(id)
	if (!provider) {
		return c.json({ error: "Provider not found" }, 404)
	}

	const categorized = ProviderRegistry.listCategorized()
	const all = [...categorized.connected, ...categorized.popular, ...categorized.other]
	const info = all.find((p) => p.id === id)

	return c.json(info ?? { error: "Provider not found" })
})

/**
 * PUT /providers/:id — Set API key for a provider.
 */
providerRoutes.put("/providers/:id", async (c) => {
	const id = c.req.param("id")
	const provider = ProviderRegistry.get(id)
	if (!provider) {
		return c.json({ error: "Provider not found" }, 404)
	}

	if (!authManager) {
		return c.json({ error: "Auth manager not initialized" }, 500)
	}

	const body = await c.req.json<{ apiKey: string; baseUrl?: string }>()
	if (!body.apiKey) {
		return c.json({ error: "apiKey is required" }, 400)
	}

	authManager.setApiKey(id, body.apiKey)
	if (body.baseUrl) {
		authManager.setBaseUrl(id, body.baseUrl)
	}
	ProviderRegistry.invalidateProvider(id)

	return c.json({ ok: true, providerId: id })
})

/**
 * DELETE /providers/:id/key — Remove API key for a provider.
 */
providerRoutes.delete("/providers/:id/key", (c) => {
	const id = c.req.param("id")
	if (!authManager) {
		return c.json({ error: "Auth manager not initialized" }, 500)
	}

	authManager.clearApiKey(id)
	authManager.clearBaseUrl(id)
	ProviderRegistry.invalidateProvider(id)

	return c.json({ ok: true })
})

/**
 * POST /providers/:id/oauth/authorize — Start OAuth device code flow.
 */
providerRoutes.post("/providers/:id/oauth/authorize", async (c) => {
	const id = c.req.param("id")
	const method = OAUTH_METHODS[id]
	if (!method) {
		return c.json({ error: `No OAuth method available for provider "${id}"` }, 400)
	}

	try {
		const body = await c.req.json<Record<string, string>>().catch(() => ({}))
		const authorization = await method.authorize(body)

		// Store the authorization for polling
		pendingAuths.set(id, authorization)

		return c.json({
			url: authorization.url,
			userCode: authorization.userCode,
			method: authorization.method,
			instructions: authorization.instructions,
		})
	} catch (err) {
		log.error("Authorization failed", { providerId: id, error: err })
		return c.json({ error: "Authorization failed" }, 500)
	}
})

/**
 * POST /providers/:id/oauth/callback — Poll/complete OAuth flow.
 */
providerRoutes.post("/providers/:id/oauth/callback", async (c) => {
	const id = c.req.param("id")
	if (!authManager) {
		return c.json({ error: "Auth manager not initialized" }, 500)
	}

	const authorization = pendingAuths.get(id)
	if (!authorization) {
		return c.json({ error: "No pending authorization. Call /oauth/authorize first." }, 400)
	}

	try {
		// Poll with timeout for device code flow
		const maxPollTime = 5 * 60 * 1000 // 5 minutes
		const pollInterval = getPollIntervalMs(id)
		const startTime = Date.now()

		while (Date.now() - startTime < maxPollTime) {
			const result = await authorization.poll()

			if (result.type === "success") {
				const oauthAuth = toOAuthAuth(result)
				authManager.setOAuthToken(id, oauthAuth)
				ProviderRegistry.invalidateProvider(id)
				pendingAuths.delete(id)
				return c.json({ ok: true })
			}

			if (result.type === "failed") {
				pendingAuths.delete(id)
				return c.json({ error: result.error }, 400)
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

// ─── Pending OAuth state ────────────────────────────────────────

/** In-memory storage for pending OAuth device code authorizations. */
const pendingAuths = new Map<string, { poll(): Promise<import("../provider/oauth").OAuthResult> }>()

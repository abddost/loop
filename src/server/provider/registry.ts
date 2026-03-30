import type { AuthMethodInfo, ModelInfo, ProviderInfo } from "@core/schema/provider"
import type { LanguageModel } from "ai"
import type { AuthManager } from "./auth"
import { getAuthHandler } from "./auth-handler"
import type { ProviderConfig, ProviderCredentials, ResolvedModel } from "./base"
import { type CustomProviderConfig, resolveCustomProvider } from "./custom"
import { POPULAR_PROVIDER_IDS, PROVIDER_DEFAULTS } from "./defaults"
import { isCodexModel } from "./handlers/codex"
import { type ModelsDevData, normalizeProvider } from "./models-dev"
import { createLanguageModel, hasBundledSDK } from "./sdk"

/**
 * Central registry for LLM providers and models.
 *
 * Coordinates:
 * - Built-in provider defaults
 * - models.dev data (70-80+ providers)
 * - Custom user-defined providers (OpenAI-compatible)
 * - AuthManager for credential resolution
 * - SDK instance caching for performance
 * - Provider categorization (Connected / Popular / Other)
 */
class ProviderRegistryImpl {
	private providers = new Map<string, ProviderConfig>()
	private auth: AuthManager | null = null
	private sdkCache = new Map<string, LanguageModel>()

	/**
	 * Inject the auth manager after DB initialization.
	 */
	setAuth(auth: AuthManager): void {
		this.auth = auth
	}

	/**
	 * Register a provider configuration.
	 */
	register(config: ProviderConfig): void {
		this.providers.set(config.id, config)
	}

	/**
	 * Get a provider by ID.
	 */
	get(id: string): ProviderConfig | undefined {
		return this.providers.get(id)
	}

	/**
	 * List all registered providers.
	 */
	list(): ProviderConfig[] {
		return Array.from(this.providers.values())
	}

	/**
	 * Register a custom OpenAI-compatible provider from user config.
	 * Creates a provider entry with custom models using @ai-sdk/openai-compatible.
	 */
	registerCustomProvider(id: string, config: CustomProviderConfig): void {
		const providerConfig = resolveCustomProvider(id, config)
		this.providers.set(id, providerConfig)
	}

	/**
	 * Load all providers from models.dev data.
	 *
	 * For each models.dev provider:
	 * 1. Check if we have a bundled SDK for its npm package
	 * 2. Create a ProviderConfig with models from models.dev
	 * 3. For providers already registered, merge models
	 */
	loadFromModelsDev(data: ModelsDevData): void {
		for (const [rawId, rawProvider] of Object.entries(data)) {
			const normalized = normalizeProvider({ ...rawProvider, id: rawId })
			if (normalized.models.length === 0) continue

			const npm = normalized.npm

			// Skip providers whose SDK we don't have bundled.
			// They need a native SDK that isn't installed.
			if (!hasBundledSDK(npm)) continue

			const defaults = PROVIDER_DEFAULTS[normalized.id]
			const authConfig = defaults?.auth ?? {
				methods: ["api-key" as const],
				envKeys: normalized.envKeys,
			}

			const existing = this.providers.get(normalized.id)
			if (existing) {
				// Custom providers take precedence — don't overwrite them
				if (existing.source === "custom") continue

				// Merge: update models from models.dev (fresher data),
				// but keep existing auth config if it has one
				this.providers.set(normalized.id, {
					...existing,
					models: mergeModels(existing.models, normalized.models),
					npm: existing.npm || npm,
					source: existing.source ?? "models-dev",
				})
			} else {
				// Capture baseUrl and name for openai-compatible providers
				const baseUrl = normalized.apiBaseUrl
				const name = normalized.name
				const config: ProviderConfig = {
					id: normalized.id,
					name,
					description: defaults?.description,
					npm,
					source: "models-dev",
					auth: authConfig,
					models: normalized.models,
					createModel: (modelId: string, credentials: ProviderCredentials) => {
						const creds = baseUrl
							? { ...credentials, baseUrl: credentials.baseUrl ?? baseUrl }
							: credentials
						return createLanguageModel(npm, modelId, creds, name)
					},
				}
				this.providers.set(normalized.id, config)
			}
		}
	}

	/**
	 * Resolve a model by provider and model ID, returning a ready-to-use instance.
	 * This is the primary interface used by the agentic loop.
	 */
	async resolveModel(providerId: string, modelId: string): Promise<ResolvedModel> {
		const provider = this.providers.get(providerId)
		if (!provider) {
			throw new Error(`Provider "${providerId}" not found`)
		}

		let info = provider.models.find((m) => m.id === modelId)
		// Fall back to "auto" if the provider supports it (e.g. after switching providers)
		const resolvedModelId = info ? modelId : "auto"
		if (!info) {
			info = provider.models.find((m) => m.id === "auto")
			if (!info) {
				throw new Error(`Model "${modelId}" not found in provider "${providerId}"`)
			}
		}

		const credentials = await this.resolveCredentials(providerId)
		if (!credentials) {
			const envHint = provider.auth.envKeys.length > 0 ? provider.auth.envKeys[0] : "an API key"
			throw new Error(
				`No credentials configured for provider "${providerId}". ` +
					`Set ${envHint} or configure via settings.`,
			)
		}

		// SDK instance caching
		const cacheKey = `${providerId}:${resolvedModelId}`
		let instance = this.sdkCache.get(cacheKey)
		if (!instance) {
			instance = provider.createModel(resolvedModelId, credentials)
			this.sdkCache.set(cacheKey, instance)
		}

		return { instance, info, providerId, npm: provider.npm }
	}

	/**
	 * Get model info without creating an SDK instance.
	 */
	getModelInfo(providerId: string, modelId: string): ModelInfo | undefined {
		const provider = this.providers.get(providerId)
		if (!provider) return undefined
		return provider.models.find((m) => m.id === modelId)
	}

	/**
	 * Remove a provider from the registry entirely.
	 * Used when deleting custom providers.
	 */
	unregister(providerId: string): void {
		this.providers.delete(providerId)
		this.invalidateProvider(providerId)
	}

	/**
	 * Invalidate cached SDK instances for a provider.
	 * Called when credentials change.
	 */
	invalidateProvider(providerId: string): void {
		for (const key of this.sdkCache.keys()) {
			if (key.startsWith(`${providerId}:`)) {
				this.sdkCache.delete(key)
			}
		}
	}

	/**
	 * Get providers categorized into Connected / Popular / Other.
	 * This is the primary API response shape for the frontend.
	 */
	async listCategorized(): Promise<{
		connected: ProviderInfo[]
		popular: ProviderInfo[]
		other: ProviderInfo[]
	}> {
		const connected: ProviderInfo[] = []
		const popular: ProviderInfo[] = []
		const other: ProviderInfo[] = []

		const popularSet = new Set(POPULAR_PROVIDER_IDS)

		for (const provider of this.providers.values()) {
			const configured = await this.isConfigured(provider.id)

			// When OpenAI is connected via Codex OAuth, filter to Codex-allowed models only
			let models = configured ? provider.models : []
			if (
				provider.id === "openai" &&
				configured &&
				models.length > 0 &&
				(await this.isOAuthConnected(provider.id))
			) {
				models = models
					.filter((m) => isCodexModel(m.id))
					.map((m) => ({ ...m, supportsReasoning: true }))
			}

			const info: ProviderInfo = {
				id: provider.id,
				name: provider.name,
				description: provider.description,
				category: "other",
				configured,
				authMethods: resolveAuthMethods(provider),
				envKeys: provider.auth.envKeys,
				models,
			}

			if (configured) {
				info.category = "connected"
				connected.push(info)
			} else if (popularSet.has(provider.id)) {
				info.category = "popular"
				popular.push(info)
			} else {
				other.push(info)
			}
		}

		// Sort connected by popular order first, then alphabetically
		connected.sort((a, b) => {
			const aIdx = POPULAR_PROVIDER_IDS.indexOf(a.id)
			const bIdx = POPULAR_PROVIDER_IDS.indexOf(b.id)
			if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
			if (aIdx !== -1) return -1
			if (bIdx !== -1) return 1
			return a.name.localeCompare(b.name)
		})

		// Sort popular by defined order
		popular.sort((a, b) => {
			return POPULAR_PROVIDER_IDS.indexOf(a.id) - POPULAR_PROVIDER_IDS.indexOf(b.id)
		})

		// Sort other alphabetically
		other.sort((a, b) => a.name.localeCompare(b.name))

		return { connected, popular, other }
	}

	/**
	 * Legacy method for backward compatibility.
	 * Returns a flat list with configured status.
	 */
	async listWithStatus(): Promise<
		Array<{
			id: string
			name: string
			configured: boolean
			models: ModelInfo[]
		}>
	> {
		const results = await Promise.all(
			this.list().map(async (p) => ({
				id: p.id,
				name: p.name,
				configured: await this.isConfigured(p.id),
				models: p.models,
			})),
		)
		return results
	}

	// ─── Private ────────────────────────────────────────────────

	private async isConfigured(providerId: string): Promise<boolean> {
		if (!this.auth) return false
		const provider = this.providers.get(providerId)
		if (!provider) return false
		return this.auth.isConfigured(providerId, provider)
	}

	private async isOAuthConnected(providerId: string): Promise<boolean> {
		if (!this.auth) return false
		const token = await this.auth.getOAuthToken(providerId)
		return token !== undefined
	}

	private async resolveCredentials(providerId: string): Promise<ProviderCredentials | undefined> {
		if (!this.auth) return undefined
		const provider = this.providers.get(providerId)
		if (!provider) return undefined

		const creds = await this.auth.resolveCredentials(providerId, provider)
		if (!creds) return undefined

		// Delegate to auth handler for custom fetch (token injection, refresh)
		const handler = getAuthHandler(providerId)
		if (creds.accessToken && handler?.createFetch) {
			const auth = this.auth
			const customFetch = handler.createFetch(
				() => auth.getOAuthToken(providerId),
				(oauthAuth) => auth.setOAuthToken(providerId, oauthAuth),
			)
			if (customFetch) {
				return {
					...creds,
					apiKey: creds.apiKey || "oauth-placeholder",
					customFetch,
				}
			}
		}

		return creds
	}
}

/**
 * Resolve auth methods for a provider.
 * If an auth handler is registered, use its rich method definitions.
 * Otherwise, generate simple method info from the provider's auth config.
 */
function resolveAuthMethods(provider: ProviderConfig): AuthMethodInfo[] {
	const handler = getAuthHandler(provider.id)
	if (handler) return handler.methods

	// Generate simple methods from provider config
	return provider.auth.methods.map((method) => {
		const envHint = provider.auth.envKeys[0]
		return {
			id: method,
			type: method,
			label: method === "api-key" ? `API Key${envHint ? ` (${envHint})` : ""}` : "OAuth",
			prompts: [],
		}
	})
}

/**
 * Merge models from two sources.
 * models.dev data takes priority for metadata (pricing, limits),
 * but we keep any built-in models that aren't in models.dev.
 */
function mergeModels(builtIn: ModelInfo[], fromModelsDev: ModelInfo[]): ModelInfo[] {
	const merged = new Map<string, ModelInfo>()

	// Add built-in models first
	for (const model of builtIn) {
		merged.set(model.id, model)
	}

	// Override/add with models.dev data (fresher pricing/limits)
	for (const model of fromModelsDev) {
		merged.set(model.id, model)
	}

	return Array.from(merged.values())
}

export const ProviderRegistry = new ProviderRegistryImpl()

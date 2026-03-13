import type { ModelInfo, ProviderInfo } from "@core/schema/provider"
import type { LanguageModel } from "ai"
import type { AuthManager } from "./auth"
import type { ProviderConfig, ProviderCredentials, ResolvedModel } from "./base"
import { POPULAR_PROVIDER_IDS, PROVIDER_DEFAULTS } from "./defaults"
import { type ModelsDevData, normalizeProvider } from "./models-dev"
import { createCopilotFetch } from "./oauth"
import { createLanguageModel, hasBundledSDK } from "./sdk"

/**
 * Central registry for LLM providers and models.
 *
 * Coordinates:
 * - Built-in provider defaults
 * - models.dev data (70-80+ providers)
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
				// Merge: update models from models.dev (fresher data),
				// but keep existing auth config if it has one
				this.providers.set(normalized.id, {
					...existing,
					models: mergeModels(existing.models, normalized.models),
					npm: existing.npm || npm,
				})
			} else {
				// Capture baseUrl and name for openai-compatible providers
				const baseUrl = normalized.apiBaseUrl
				const name = normalized.name
				const config: ProviderConfig = {
					id: normalized.id,
					name,
					npm,
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
	resolveModel(providerId: string, modelId: string): ResolvedModel {
		const provider = this.providers.get(providerId)
		if (!provider) {
			throw new Error(`Provider "${providerId}" not found`)
		}

		const info = provider.models.find((m) => m.id === modelId)
		if (!info) {
			throw new Error(`Model "${modelId}" not found in provider "${providerId}"`)
		}

		const credentials = this.resolveCredentials(providerId)
		if (!credentials) {
			const envHint = provider.auth.envKeys.length > 0 ? provider.auth.envKeys[0] : "an API key"
			throw new Error(
				`No credentials configured for provider "${providerId}". ` +
					`Set ${envHint} or configure via settings.`,
			)
		}

		// SDK instance caching
		const cacheKey = `${providerId}:${modelId}`
		let instance = this.sdkCache.get(cacheKey)
		if (!instance) {
			instance = provider.createModel(modelId, credentials)
			this.sdkCache.set(cacheKey, instance)
		}

		return { instance, info, providerId }
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
	listCategorized(): {
		connected: ProviderInfo[]
		popular: ProviderInfo[]
		other: ProviderInfo[]
	} {
		const connected: ProviderInfo[] = []
		const popular: ProviderInfo[] = []
		const other: ProviderInfo[] = []

		const popularSet = new Set(POPULAR_PROVIDER_IDS)

		for (const provider of this.providers.values()) {
			const configured = this.isConfigured(provider.id)
			const info: ProviderInfo = {
				id: provider.id,
				name: provider.name,
				category: "other",
				configured,
				authMethods: provider.auth.methods,
				envKeys: provider.auth.envKeys,
				models: provider.models,
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
	listWithStatus(): Array<{
		id: string
		name: string
		configured: boolean
		models: ModelInfo[]
	}> {
		return this.list().map((p) => ({
			id: p.id,
			name: p.name,
			configured: this.isConfigured(p.id),
			models: p.models,
		}))
	}

	// ─── Private ────────────────────────────────────────────────

	private isConfigured(providerId: string): boolean {
		if (!this.auth) return false
		const provider = this.providers.get(providerId)
		if (!provider) return false
		return this.auth.isConfigured(providerId, provider)
	}

	private resolveCredentials(providerId: string): ProviderCredentials | undefined {
		if (!this.auth) return undefined
		const provider = this.providers.get(providerId)
		if (!provider) return undefined

		const creds = this.auth.resolveCredentials(providerId, provider)
		if (!creds) return undefined

		// Special handling for OAuth providers (e.g., GitHub Copilot)
		if (creds.accessToken && providerId === "github-copilot") {
			const token = creds.accessToken
			return {
				...creds,
				apiKey: "", // SDK requires non-undefined apiKey
				customFetch: createCopilotFetch(() => token),
			}
		}

		return creds
	}
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

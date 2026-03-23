import type { OAuthAuth, WellKnownAuth } from "@core/schema/provider"
import { Auth } from "../auth"
import { getConfigValue, setConfigValue } from "../db/queries"
import type { ProviderConfig, ProviderCredentials } from "./base"

const CONFIG_KEY_PREFIX = "provider:"

/**
 * Manages provider credentials (API keys, OAuth tokens, and well-known auth).
 *
 * Storage is delegated to the Auth module ({dataDir}/auth.json with 0o600 perms).
 * Base URLs and legacy API key lookups still use the SQLite config table.
 *
 * Resolution chain: Auth module → SQLite (legacy) → process.env
 */
export class AuthManager {
	private memoryCache = new Map<string, string>()

	// ─── API Key Auth ───────────────────────────────────────────

	/**
	 * Set an API key for a provider. Persists to Auth module and updates memory cache.
	 */
	async setApiKey(providerId: string, apiKey: string): Promise<void> {
		this.memoryCache.set(providerId, apiKey)
		await Auth.set(providerId, { type: "api-key", key: apiKey })
	}

	/**
	 * Get the API key for a provider.
	 * Resolution chain: memory → Auth module → SQLite (legacy) → process.env
	 */
	async getApiKey(providerId: string, envKeys: string[]): Promise<string | undefined> {
		// 1. Memory cache
		const cached = this.memoryCache.get(providerId)
		if (cached) return cached

		// 2. Auth module (file-based)
		const authInfo = await Auth.get(providerId)
		if (authInfo?.type === "api-key" && authInfo.key.length > 0) {
			this.memoryCache.set(providerId, authInfo.key)
			return authInfo.key
		}

		// 3. SQLite config table (legacy fallback)
		const stored = getConfigValue(`${CONFIG_KEY_PREFIX}${providerId}:apiKey`)
		if (stored) {
			try {
				const key = JSON.parse(stored)
				if (typeof key === "string" && key.length > 0) {
					this.memoryCache.set(providerId, key)
					return key
				}
			} catch {
				// Malformed JSON, skip
			}
		}

		// 4. Environment variables
		for (const envKey of envKeys) {
			const val = process.env[envKey]
			if (val) return val
		}

		return undefined
	}

	/**
	 * Remove a provider's API key from all storage layers.
	 */
	async clearApiKey(providerId: string): Promise<void> {
		this.memoryCache.delete(providerId)
		await Auth.remove(providerId)
		// Also clear legacy SQLite entry
		setConfigValue(`${CONFIG_KEY_PREFIX}${providerId}:apiKey`, JSON.stringify(""))
	}

	// ─── Base URL ───────────────────────────────────────────────

	/**
	 * Set a custom base URL for a provider. Persists to SQLite.
	 */
	setBaseUrl(providerId: string, baseUrl: string): void {
		setConfigValue(`${CONFIG_KEY_PREFIX}${providerId}:baseUrl`, JSON.stringify(baseUrl))
	}

	/**
	 * Get the custom base URL for a provider.
	 */
	getBaseUrl(providerId: string): string | undefined {
		const stored = getConfigValue(`${CONFIG_KEY_PREFIX}${providerId}:baseUrl`)
		if (stored) {
			try {
				const url = JSON.parse(stored)
				if (typeof url === "string" && url.length > 0) return url
			} catch {
				// Malformed JSON, skip
			}
		}
		return undefined
	}

	/**
	 * Remove a provider's custom base URL.
	 */
	clearBaseUrl(providerId: string): void {
		setConfigValue(`${CONFIG_KEY_PREFIX}${providerId}:baseUrl`, JSON.stringify(""))
	}

	// ─── OAuth Auth ─────────────────────────────────────────────

	/**
	 * Get an OAuth token for a provider.
	 */
	async getOAuthToken(providerId: string): Promise<OAuthAuth | undefined> {
		const info = await Auth.get(providerId)
		if (info?.type === "oauth") return info
		return undefined
	}

	/**
	 * Get an OAuth token, auto-refreshing if expired.
	 * Uses the provided refresh function to obtain new tokens.
	 * A 60-second buffer is applied before actual expiration.
	 */
	async getOAuthTokenWithRefresh(
		providerId: string,
		refreshFn?: (token: OAuthAuth) => Promise<OAuthAuth | undefined>,
	): Promise<OAuthAuth | undefined> {
		const token = await this.getOAuthToken(providerId)
		if (!token) return undefined

		// 0 = never expires
		if (token.expiresAt > 0 && Date.now() >= token.expiresAt - 60_000) {
			if (!refreshFn) return undefined
			const refreshed = await refreshFn(token)
			if (refreshed) {
				await this.setOAuthToken(providerId, refreshed)
				return refreshed
			}
			return undefined
		}

		return token
	}

	/**
	 * Store an OAuth token for a provider.
	 */
	async setOAuthToken(providerId: string, token: OAuthAuth): Promise<void> {
		await Auth.set(providerId, token)
	}

	/**
	 * Remove an OAuth token for a provider.
	 */
	async clearOAuthToken(providerId: string): Promise<void> {
		await Auth.remove(providerId)
	}

	// ─── Well-Known Auth ────────────────────────────────────────

	/**
	 * Get a well-known auth entry for a provider.
	 */
	async getWellKnownAuth(providerId: string): Promise<WellKnownAuth | undefined> {
		const info = await Auth.get(providerId)
		if (info?.type === "wellknown") return info
		return undefined
	}

	/**
	 * Store a well-known auth entry for a provider.
	 */
	async setWellKnownAuth(providerId: string, auth: WellKnownAuth): Promise<void> {
		await Auth.set(providerId, auth)
	}

	// ─── Combined Resolution ────────────────────────────────────

	/**
	 * Resolve credentials for a provider from the best available source.
	 * Checks API key, OAuth, and well-known auth sources.
	 */
	async resolveCredentials(
		providerId: string,
		config: ProviderConfig,
	): Promise<ProviderCredentials | undefined> {
		const baseUrl = this.getBaseUrl(providerId)

		// Check unified auth store first
		const authInfo = await Auth.get(providerId)
		if (authInfo) {
			switch (authInfo.type) {
				case "api-key":
					if (authInfo.key.length > 0) {
						return { apiKey: authInfo.key, ...(baseUrl && { baseUrl }) }
					}
					break
				case "oauth":
					return { accessToken: authInfo.accessToken, ...(baseUrl && { baseUrl }) }
				case "wellknown":
					return { apiKey: authInfo.token, ...(baseUrl && { baseUrl }) }
			}
		}

		// Fall back to legacy API key resolution (SQLite + env vars)
		const apiKey = await this.getApiKey(providerId, config.auth.envKeys)
		if (apiKey) {
			return { apiKey, ...(baseUrl && { baseUrl }) }
		}

		return undefined
	}

	/**
	 * Check if a provider has any valid credentials configured.
	 */
	async isConfigured(providerId: string, config: ProviderConfig): Promise<boolean> {
		return (await this.resolveCredentials(providerId, config)) !== undefined
	}
}

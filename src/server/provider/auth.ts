import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { AuthInfo, OAuthAuth } from "@core/schema/provider"
import { getConfigValue, setConfigValue } from "../db/queries"
import { env } from "../env"
import type { ProviderConfig, ProviderCredentials } from "./base"

const CONFIG_KEY_PREFIX = "provider:"
const AUTH_FILE_NAME = "auth.json"

/**
 * Manages provider credentials (API keys and OAuth tokens).
 *
 * API keys: stored in SQLite config table (key: "provider:{id}:apiKey")
 * OAuth tokens: stored in {dataDir}/auth.json (file with restricted permissions)
 *
 * Resolution chain for API keys: memory cache → SQLite → process.env
 */
export class AuthManager {
	private memoryCache = new Map<string, string>()
	private oauthCache: Record<string, AuthInfo> | null = null

	constructor() {
		this.loadOAuthCache()
	}

	// ─── API Key Auth ───────────────────────────────────────────

	/**
	 * Set an API key for a provider. Persists to SQLite and updates memory cache.
	 */
	setApiKey(providerId: string, apiKey: string): void {
		this.memoryCache.set(providerId, apiKey)
		setConfigValue(`${CONFIG_KEY_PREFIX}${providerId}:apiKey`, JSON.stringify(apiKey))
	}

	/**
	 * Get the API key for a provider.
	 * Resolution chain: memory → SQLite → process.env
	 */
	getApiKey(providerId: string, envKeys: string[]): string | undefined {
		// 1. Memory cache
		const cached = this.memoryCache.get(providerId)
		if (cached) return cached

		// 2. SQLite config table
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

		// 3. Environment variables
		for (const envKey of envKeys) {
			const val = process.env[envKey]
			if (val) return val
		}

		return undefined
	}

	/**
	 * Remove a provider's API key from all storage layers.
	 */
	clearApiKey(providerId: string): void {
		this.memoryCache.delete(providerId)
		setConfigValue(`${CONFIG_KEY_PREFIX}${providerId}:apiKey`, JSON.stringify(""))
	}

	// ─── OAuth Auth ─────────────────────────────────────────────

	/**
	 * Get an OAuth token for a provider.
	 */
	getOAuthToken(providerId: string): OAuthAuth | undefined {
		const all = this.getOAuthAll()
		const info = all[providerId]
		if (info?.type === "oauth") return info
		return undefined
	}

	/**
	 * Store an OAuth token for a provider.
	 */
	setOAuthToken(providerId: string, token: OAuthAuth): void {
		const all = this.getOAuthAll()
		all[providerId] = token
		this.writeOAuthFile(all)
	}

	/**
	 * Remove an OAuth token for a provider.
	 */
	clearOAuthToken(providerId: string): void {
		const all = this.getOAuthAll()
		delete all[providerId]
		this.writeOAuthFile(all)
	}

	// ─── Combined Resolution ────────────────────────────────────

	/**
	 * Resolve credentials for a provider from the best available source.
	 * Checks API key and OAuth token sources.
	 */
	resolveCredentials(providerId: string, config: ProviderConfig): ProviderCredentials | undefined {
		// Check API key first
		const apiKey = this.getApiKey(providerId, config.auth.envKeys)
		if (apiKey) {
			return { apiKey }
		}

		// Check OAuth
		const oauth = this.getOAuthToken(providerId)
		if (oauth) {
			return { accessToken: oauth.accessToken }
		}

		return undefined
	}

	/**
	 * Check if a provider has any valid credentials configured.
	 */
	isConfigured(providerId: string, config: ProviderConfig): boolean {
		return this.resolveCredentials(providerId, config) !== undefined
	}

	// ─── Private ────────────────────────────────────────────────

	private getAuthFilePath(): string {
		return resolve(env.dataDir, AUTH_FILE_NAME)
	}

	private loadOAuthCache(): void {
		try {
			const path = this.getAuthFilePath()
			if (existsSync(path)) {
				const raw = readFileSync(path, "utf-8")
				this.oauthCache = JSON.parse(raw)
			} else {
				this.oauthCache = {}
			}
		} catch {
			this.oauthCache = {}
		}
	}

	private getOAuthAll(): Record<string, AuthInfo> {
		if (!this.oauthCache) {
			this.loadOAuthCache()
		}
		return this.oauthCache!
	}

	private writeOAuthFile(data: Record<string, AuthInfo>): void {
		this.oauthCache = data
		const path = this.getAuthFilePath()
		writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 })
	}
}

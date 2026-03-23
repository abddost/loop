import type { ModelInfo } from "@core/schema/provider"
import type { LanguageModel } from "ai"

export type { ModelInfo }

/**
 * Credentials used to authenticate with a provider SDK.
 */
export interface ProviderCredentials {
	apiKey?: string
	baseUrl?: string
	accessToken?: string
	customFetch?: typeof fetch
}

/**
 * How a provider was discovered / configured.
 * - "env": detected via environment variable
 * - "config": explicitly configured in app config
 * - "custom": user-defined OpenAI-compatible provider
 * - "models-dev": loaded from models.dev registry
 */
export type ProviderSource = "env" | "config" | "custom" | "models-dev"

/**
 * Configuration for an LLM provider.
 */
export interface ProviderConfig {
	id: string
	name: string
	description?: string
	/** npm package identifier for the AI SDK (e.g. "@ai-sdk/anthropic") */
	npm: string
	/** How this provider was discovered or configured */
	source?: ProviderSource
	auth: {
		methods: Array<"api-key" | "oauth">
		envKeys: string[]
	}
	models: ModelInfo[]
	createModel(modelId: string, credentials: ProviderCredentials): LanguageModel
}

/**
 * A fully resolved model ready for use.
 */
export interface ResolvedModel {
	instance: LanguageModel
	info: ModelInfo
	providerId: string
}

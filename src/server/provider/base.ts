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
 * Configuration for an LLM provider.
 */
export interface ProviderConfig {
	id: string
	name: string
	/** npm package identifier for the AI SDK (e.g. "@ai-sdk/anthropic") */
	npm: string
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

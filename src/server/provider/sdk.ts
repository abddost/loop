import { createAnthropic } from "@ai-sdk/anthropic"
import { createCohere } from "@ai-sdk/cohere"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGroq } from "@ai-sdk/groq"
import { createMistral } from "@ai-sdk/mistral"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createXai } from "@ai-sdk/xai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel } from "ai"
import type { ProviderCredentials } from "./base"

type SDKFactory = (options: any) => any

/**
 * Map of npm package names to their bundled AI SDK factory functions.
 * When models.dev provides a provider's npm field, we look it up here
 * to create the correct SDK instance. Falls back to openai-compatible.
 */
const BUNDLED_SDKS: Record<string, SDKFactory> = {
	"@ai-sdk/anthropic": createAnthropic,
	"@ai-sdk/openai": createOpenAI,
	"@ai-sdk/google": createGoogleGenerativeAI,
	"@ai-sdk/xai": createXai,
	"@ai-sdk/mistral": createMistral,
	"@ai-sdk/groq": createGroq,
	"@ai-sdk/cohere": createCohere,
	"@ai-sdk/deepinfra": createDeepInfra,
	"@ai-sdk/deepseek": createDeepSeek,
	"@ai-sdk/togetherai": createTogetherAI,
	"@ai-sdk/perplexity": createPerplexity,
	"@ai-sdk/openai-compatible": createOpenAICompatible,
	"@openrouter/ai-sdk-provider": createOpenRouter,
}

/**
 * Check if a bundled SDK exists for the given npm package.
 */
export function hasBundledSDK(npmPackage: string): boolean {
	return npmPackage in BUNDLED_SDKS
}

/**
 * Get the SDK factory for a given npm package.
 * Falls back to @ai-sdk/openai-compatible if not bundled.
 */
function getSDKFactory(npmPackage: string): SDKFactory {
	return BUNDLED_SDKS[npmPackage] ?? BUNDLED_SDKS["@ai-sdk/openai-compatible"]
}

/**
 * Create a LanguageModel instance using the bundled SDK map.
 *
 * For openai-compatible providers, `credentials.baseUrl` and `providerName`
 * are required by the SDK.
 *
 * @param npmPackage - npm package identifier for the AI SDK
 * @param modelId - Model identifier passed to the SDK
 * @param credentials - API key, base URL, and optional custom fetch
 * @param providerName - Display name for openai-compatible providers
 * @param extraHeaders - Additional HTTP headers to include in requests
 */
export function createLanguageModel(
	npmPackage: string,
	modelId: string,
	credentials: ProviderCredentials,
	providerName?: string,
	extraHeaders?: Record<string, string>,
): LanguageModel {
	const factory = getSDKFactory(npmPackage)
	const options: Record<string, unknown> = {}

	if (credentials.apiKey) options.apiKey = credentials.apiKey
	if (credentials.baseUrl) options.baseURL = credentials.baseUrl
	if (credentials.customFetch) options.fetch = credentials.customFetch

	// openai-compatible requires a name
	if (npmPackage === "@ai-sdk/openai-compatible" && providerName) {
		options.name = providerName
	}

	// Inject extra headers via SDK options if supported
	if (extraHeaders && Object.keys(extraHeaders).length > 0) {
		options.headers = extraHeaders
	}

	const sdk = factory(options)
	return sdk(modelId) as LanguageModel
}

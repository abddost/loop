import type { ModelInfo } from "@core/schema/provider"
import { z } from "zod"
import type { ProviderConfig, ProviderCredentials } from "./base"
import { createLanguageModel } from "./sdk"

// ─── Schema ────────────────────────────────────────────────────

/**
 * Schema for custom model definitions in config.
 * Users specify capabilities and limits; we normalize to ModelInfo.
 */
export const CustomModelSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	supportsImages: z.boolean().default(false),
	supportsTools: z.boolean().default(true),
	supportsReasoning: z.boolean().default(false),
	supportsTemperature: z.boolean().default(true),
	contextWindow: z.number().default(128_000),
	maxOutput: z.number().default(4_096),
})

export type CustomModelConfig = z.infer<typeof CustomModelSchema>

/**
 * Schema for a custom OpenAI-compatible provider in config.
 * Supports env var references like "{env:MY_KEY}" for the API key.
 */
export const CustomProviderSchema = z.object({
	name: z.string(),
	baseUrl: z.string(),
	apiKey: z.string().optional(),
	models: z.array(CustomModelSchema).min(1),
	headers: z.record(z.string(), z.string()).optional(),
})

export type CustomProviderConfig = z.infer<typeof CustomProviderSchema>

// ─── Resolution ────────────────────────────────────────────────

const ENV_REF_PATTERN = /^\{env:([^}]+)\}$/

/**
 * Resolve an API key value that may be a literal string or an
 * env var reference like "{env:MY_API_KEY}".
 */
export function resolveEnvRef(value: string | undefined): string | undefined {
	if (!value) return undefined
	const match = ENV_REF_PATTERN.exec(value)
	if (match) {
		return process.env[match[1]]
	}
	return value
}

/**
 * Convert custom model configs to ModelInfo format.
 */
function toModelInfoList(models: CustomModelConfig[], providerId: string): ModelInfo[] {
	return models.map((m) => ({
		id: m.id,
		name: m.name ?? m.id,
		providerId,
		supportsImages: m.supportsImages,
		supportsTools: m.supportsTools,
		supportsReasoning: m.supportsReasoning,
		supportsTemperature: m.supportsTemperature,
		modalities: {
			input: m.supportsImages ? ["text", "image"] : ["text"],
			output: ["text"],
		},
		contextWindow: m.contextWindow,
		maxOutput: m.maxOutput,
		pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		status: "active" as const,
	}))
}

/**
 * Resolve a custom provider config into a full ProviderConfig.
 * Uses @ai-sdk/openai-compatible under the hood.
 */
export function resolveCustomProvider(id: string, config: CustomProviderConfig): ProviderConfig {
	const npm = "@ai-sdk/openai-compatible"
	const models = toModelInfoList(config.models, id)
	const resolvedApiKey = resolveEnvRef(config.apiKey)
	const customHeaders = config.headers

	return {
		id,
		name: config.name,
		description: `Custom provider: ${config.name}`,
		npm,
		source: "custom",
		auth: {
			methods: ["api-key"],
			envKeys: extractEnvKeys(config.apiKey),
		},
		models,
		createModel: (modelId: string, credentials: ProviderCredentials) => {
			const creds: ProviderCredentials = {
				...credentials,
				baseUrl: credentials.baseUrl ?? config.baseUrl,
				apiKey: credentials.apiKey ?? resolvedApiKey,
			}
			if (customHeaders) {
				const originalFetch = creds.customFetch ?? globalThis.fetch
				creds.customFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
					const headers = new Headers(init?.headers)
					for (const [key, value] of Object.entries(customHeaders)) {
						headers.set(key, value)
					}
					return originalFetch(input, { ...init, headers })
				}) as typeof fetch
			}
			return createLanguageModel(npm, modelId, creds, config.name)
		},
	}
}

/**
 * Extract env key names from an apiKey value that uses {env:KEY} syntax.
 */
function extractEnvKeys(apiKey: string | undefined): string[] {
	if (!apiKey) return []
	const match = ENV_REF_PATTERN.exec(apiKey)
	if (match) return [match[1]]
	return []
}

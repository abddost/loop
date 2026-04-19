import { z } from "zod"

// ─── Model Info ─────────────────────────────────────────────────

export const ModelInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	providerId: z.string(),
	family: z.string().optional(),

	// Capabilities
	supportsImages: z.boolean(),
	supportsTools: z.boolean(),
	supportsReasoning: z.boolean(),
	supportsTemperature: z.boolean().default(true),

	// Modalities
	modalities: z
		.object({
			input: z.array(z.string()),
			output: z.array(z.string()),
		})
		.default({ input: ["text"], output: ["text"] }),

	// Limits (tokens)
	contextWindow: z.number(),
	maxOutput: z.number(),

	// Pricing (per 1M tokens, USD)
	pricing: z.object({
		input: z.number(),
		output: z.number(),
		cacheRead: z.number().default(0),
		cacheWrite: z.number().default(0),
	}),

	// Lifecycle
	status: z.enum(["active", "beta", "deprecated"]).default("active"),
	releaseDate: z.string().optional(),

	// Model variants (e.g. different parameter presets)
	variants: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),

	// ─── Claude Code specific capabilities ─────────────────────
	// These fields are optional and only populated for Claude Code models.

	/** Effort levels the model supports (e.g. ["low","medium","high","max"]). */
	effortLevels: z.array(z.string()).optional(),
	/** Default effort level. */
	defaultEffort: z.string().optional(),
	/** Prompt-injected effort levels (not passed as API param, e.g. "ultrathink"). */
	promptInjectedEffort: z.array(z.string()).optional(),
})

export type ModelInfo = z.infer<typeof ModelInfoSchema>

// ─── Auth Info ──────────────────────────────────────────────────

export const ApiKeyAuthSchema = z.object({
	type: z.literal("api-key"),
	key: z.string(),
})

export const OAuthAuthSchema = z.object({
	type: z.literal("oauth"),
	accessToken: z.string(),
	refreshToken: z.string(),
	expiresAt: z.number(), // epoch ms, 0 = never
	accountId: z.string().optional(),
})

export const WellKnownAuthSchema = z.object({
	type: z.literal("wellknown"),
	key: z.string(),
	token: z.string(),
})

export const AuthInfoSchema = z.discriminatedUnion("type", [
	ApiKeyAuthSchema,
	OAuthAuthSchema,
	WellKnownAuthSchema,
])

export type AuthInfo = z.infer<typeof AuthInfoSchema>
export type ApiKeyAuth = z.infer<typeof ApiKeyAuthSchema>
export type OAuthAuth = z.infer<typeof OAuthAuthSchema>
export type WellKnownAuth = z.infer<typeof WellKnownAuthSchema>

// ─── Auth Method Prompts ─────────────────────────────────────────

export const AuthPromptSchema = z.object({
	type: z.enum(["text", "select"]),
	key: z.string(),
	label: z.string(),
	placeholder: z.string().optional(),
	options: z
		.array(z.object({ label: z.string(), value: z.string(), hint: z.string().optional() }))
		.optional(),
	when: z
		.object({
			key: z.string(),
			op: z.enum(["eq", "neq"]),
			value: z.string(),
		})
		.optional(),
})

export type AuthPrompt = z.infer<typeof AuthPromptSchema>

export const AuthMethodInfoSchema = z.object({
	id: z.string(),
	type: z.enum(["api-key", "oauth"]),
	label: z.string(),
	description: z.string().optional(),
	prompts: z.array(AuthPromptSchema).default([]),
})

export type AuthMethodInfo = z.infer<typeof AuthMethodInfoSchema>

// ─── Provider Info (API response to frontend) ───────────────────

export const ProviderInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	category: z.enum(["connected", "popular", "other"]),
	configured: z.boolean(),
	authMethods: z.array(AuthMethodInfoSchema),
	envKeys: z.array(z.string()),
	models: z.array(ModelInfoSchema),
	source: z.enum(["env", "config", "custom", "api"]).optional(),
})

export type ProviderInfo = z.infer<typeof ProviderInfoSchema>

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

export const AuthInfoSchema = z.discriminatedUnion("type", [ApiKeyAuthSchema, OAuthAuthSchema])

export type AuthInfo = z.infer<typeof AuthInfoSchema>
export type ApiKeyAuth = z.infer<typeof ApiKeyAuthSchema>
export type OAuthAuth = z.infer<typeof OAuthAuthSchema>

// ─── Provider Info (API response to frontend) ───────────────────

export const ProviderInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	category: z.enum(["connected", "popular", "other"]),
	configured: z.boolean(),
	authMethods: z.array(z.enum(["api-key", "oauth", "custom-endpoint"])),
	envKeys: z.array(z.string()),
	models: z.array(ModelInfoSchema),
})

export type ProviderInfo = z.infer<typeof ProviderInfoSchema>

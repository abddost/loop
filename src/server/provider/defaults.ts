/**
 * Built-in provider defaults that supplement models.dev data.
 * These are merged INTO providers loaded from models.dev, providing
 * auth configuration and descriptions that models.dev doesn't have.
 */
export interface ProviderDefaults {
	description?: string
	auth: {
		methods: Array<"api-key" | "oauth" | "custom-endpoint">
		envKeys: string[]
	}
}

/**
 * Hardcoded auth configuration for well-known providers.
 * For providers not listed here, defaults are derived from
 * models.dev env field: { methods: ["api-key"], envKeys: provider.env }
 */
export const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
	anthropic: {
		description: "Claude models for advanced reasoning and coding",
		auth: { methods: ["api-key"], envKeys: ["ANTHROPIC_API_KEY"] },
	},
	openai: {
		description: "GPT and o-series models for general-purpose AI",
		auth: { methods: ["api-key", "custom-endpoint"], envKeys: ["OPENAI_API_KEY"] },
	},
	google: {
		description: "Gemini models for fast, structured responses",
		auth: { methods: ["api-key", "custom-endpoint"], envKeys: ["GOOGLE_GENERATIVE_AI_API_KEY"] },
	},
	openrouter: {
		description: "Unified access to multiple AI providers",
		auth: { methods: ["api-key"], envKeys: ["OPENROUTER_API_KEY"] },
	},
	xai: {
		description: "Grok models for reasoning and analysis",
		auth: { methods: ["api-key", "custom-endpoint"], envKeys: ["XAI_API_KEY"] },
	},
	mistral: {
		description: "European AI models for efficient inference",
		auth: { methods: ["api-key", "custom-endpoint"], envKeys: ["MISTRAL_API_KEY"] },
	},
	groq: {
		description: "High-speed inference with optimized hardware",
		auth: { methods: ["api-key", "custom-endpoint"], envKeys: ["GROQ_API_KEY"] },
	},
	cohere: {
		description: "Enterprise-grade language AI models",
		auth: { methods: ["api-key", "custom-endpoint"], envKeys: ["COHERE_API_KEY"] },
	},
	deepinfra: {
		description: "Cost-effective model hosting and inference",
		auth: { methods: ["api-key", "custom-endpoint"], envKeys: ["DEEPINFRA_API_KEY"] },
	},
	deepseek: {
		description: "Advanced reasoning and coding models",
		auth: { methods: ["api-key", "custom-endpoint"], envKeys: ["DEEPSEEK_API_KEY"] },
	},
	togetherai: {
		description: "Open-source model hosting platform",
		auth: { methods: ["api-key", "custom-endpoint"], envKeys: ["TOGETHER_AI_API_KEY"] },
	},
	perplexity: {
		description: "AI-powered search and answer models",
		auth: { methods: ["api-key", "custom-endpoint"], envKeys: ["PERPLEXITY_API_KEY"] },
	},
	"github-copilot": {
		description: "AI models for coding assistance via GitHub Copilot",
		auth: { methods: ["oauth"], envKeys: [] },
	},
}

/**
 * Popular provider IDs shown in a separate UI category.
 * Order matters — determines display order in the UI.
 */
export const POPULAR_PROVIDER_IDS = [
	"anthropic",
	"openai",
	"google",
	"openrouter",
	"xai",
	"mistral",
	"groq",
	"deepseek",
	"github-copilot",
]

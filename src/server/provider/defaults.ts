/**
 * Built-in provider defaults that supplement models.dev data.
 * These are merged INTO providers loaded from models.dev, providing
 * auth configuration that models.dev doesn't have.
 */
export interface ProviderDefaults {
	auth: {
		methods: Array<"api-key" | "oauth">
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
		auth: { methods: ["api-key"], envKeys: ["ANTHROPIC_API_KEY"] },
	},
	openai: {
		auth: { methods: ["api-key"], envKeys: ["OPENAI_API_KEY"] },
	},
	google: {
		auth: { methods: ["api-key"], envKeys: ["GOOGLE_GENERATIVE_AI_API_KEY"] },
	},
	openrouter: {
		auth: { methods: ["api-key"], envKeys: ["OPENROUTER_API_KEY"] },
	},
	xai: {
		auth: { methods: ["api-key"], envKeys: ["XAI_API_KEY"] },
	},
	mistral: {
		auth: { methods: ["api-key"], envKeys: ["MISTRAL_API_KEY"] },
	},
	groq: {
		auth: { methods: ["api-key"], envKeys: ["GROQ_API_KEY"] },
	},
	cohere: {
		auth: { methods: ["api-key"], envKeys: ["COHERE_API_KEY"] },
	},
	deepinfra: {
		auth: { methods: ["api-key"], envKeys: ["DEEPINFRA_API_KEY"] },
	},
	deepseek: {
		auth: { methods: ["api-key"], envKeys: ["DEEPSEEK_API_KEY"] },
	},
	togetherai: {
		auth: { methods: ["api-key"], envKeys: ["TOGETHER_AI_API_KEY"] },
	},
	perplexity: {
		auth: { methods: ["api-key"], envKeys: ["PERPLEXITY_API_KEY"] },
	},
	"github-copilot": {
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

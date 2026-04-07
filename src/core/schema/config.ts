import { z } from "zod"
import { KeybindingOverridesSchema } from "./keybinding"
import { McpServerConfigSchema } from "./mcp"
import { ApprovalPolicySchema, PermissionConfigSchema } from "./permission"

const DEFAULT_PERMISSION_RULES = {
	read: "allow" as const,
	glob: "allow" as const,
	grep: "allow" as const,
	list: "allow" as const,
	bash: "ask" as const,
	edit: "ask" as const,
	write: "ask" as const,
	task: "ask" as const,
	"web-fetch": "ask" as const,
	"web-search": "ask" as const,
	doom_loop: "ask" as const,
	mcp: "ask" as const,
	skill: "allow" as const,
}

export const PermissionSectionSchema = z.object({
	approvalPolicy: ApprovalPolicySchema.default("default"),
	rules: PermissionConfigSchema.default(DEFAULT_PERMISSION_RULES),
})

export const AppearanceSchema = z.object({
	/** Color mode: "dark", "light", or "system" (follows OS preference) */
	mode: z.enum(["dark", "light", "system"]).default("dark"),
	/** Theme ID for dark mode (from built-in theme registry) */
	darkTheme: z.string().default("loop-dark"),
	/** Theme ID for light mode (from built-in theme registry) */
	lightTheme: z.string().default("loop-light"),
	/** Per-color overrides for dark theme. Keys are ThemeColors field names, values are hex strings. */
	darkColorOverrides: z.record(z.string(), z.string()).default({}),
	/** Per-color overrides for light theme. Keys are ThemeColors field names, values are hex strings. */
	lightColorOverrides: z.record(z.string(), z.string()).default({}),
	/** UI font family name (loaded from Google Fonts or system). null = system default. */
	uiFont: z.string().nullable().default(null),
	/** Code/mono font family name. null = system default. */
	codeFont: z.string().nullable().default(null),
	/** UI font size in pixels */
	uiFontSize: z.number().min(10).max(24).default(14),
	/** Code font size in pixels */
	codeFontSize: z.number().min(10).max(24).default(13),
	/** Contrast level: 0 = low, 50 = default, 100 = high */
	contrast: z.number().min(0).max(100).default(50),
})

export type Appearance = z.infer<typeof AppearanceSchema>

// ── Provider Configuration ────────────────────────────────────

/** Per-model overrides within a provider. */
export const ProviderModelOverrideSchema = z.object({
	/** Override context window size. */
	contextWindow: z.number().positive().optional(),
	/** Override max output tokens. */
	maxOutput: z.number().positive().optional(),
	/** Override pricing (per 1M tokens, USD). */
	pricing: z
		.object({
			input: z.number().optional(),
			output: z.number().optional(),
			cacheRead: z.number().optional(),
			cacheWrite: z.number().optional(),
		})
		.optional(),
	/** Disable this model entirely. */
	disabled: z.boolean().optional(),
})

export type ProviderModelOverride = z.infer<typeof ProviderModelOverrideSchema>

/** Provider-level configuration (user-defined overrides for a provider). */
export const ProviderConfigSchema = z.object({
	/** Display name for this provider. */
	name: z.string().optional(),
	/** npm package for the AI SDK (e.g. "@ai-sdk/anthropic"). */
	npm: z.string().optional(),
	/** Base API URL override. */
	api: z.string().optional(),
	/** Environment variable names to check for API keys. */
	envKeys: z.array(z.string()).optional(),
	/** Provider SDK options. */
	options: z
		.object({
			apiKey: z.string().optional(),
			baseURL: z.string().optional(),
			timeout: z.number().int().positive().optional(),
		})
		.catchall(z.unknown())
		.optional(),
	/** Per-model overrides, keyed by model ID. */
	models: z.record(z.string(), ProviderModelOverrideSchema).optional(),
	/** Only show these models (glob patterns). */
	whitelist: z.array(z.string()).optional(),
	/** Hide these models (glob patterns). Takes precedence over whitelist. */
	blacklist: z.array(z.string()).optional(),
	/** Extra headers to send with every request. */
	headers: z.record(z.string(), z.string()).optional(),
})

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

// ── Reasoning Configuration ──────────────────────────────────

export const ReasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh"])
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>

export const ReasoningSummarySchema = z.enum(["auto", "concise", "detailed"])
export type ReasoningSummary = z.infer<typeof ReasoningSummarySchema>

export const ReasoningConfigSchema = z.object({
	/** Default reasoning effort for models that support it. */
	effort: ReasoningEffortSchema.default("medium"),
	/** Reasoning summary mode (Codex endpoint only). */
	summary: ReasoningSummarySchema.default("auto"),
})

export type ReasoningConfig = z.infer<typeof ReasoningConfigSchema>

// ── Formatter Configuration ───────────────────────────────────

export const FormatterConfigSchema = z.object({
	/** Command and arguments to run the formatter (e.g. ["prettier", "--write"]). */
	command: z.array(z.string()),
	/** File extensions this formatter handles (e.g. [".ts", ".tsx"]). */
	extensions: z.array(z.string()).optional(),
	/** Disable this formatter. */
	disabled: z.boolean().optional(),
})

export type FormatterConfig = z.infer<typeof FormatterConfigSchema>

// ── App Config ────────────────────────────────────────────────

export const AppConfigSchema = z.object({
	$schema: z.string().optional(),
	/** @deprecated Use appearance.mode instead. Kept for migration. */
	theme: z.enum(["dark", "light"]).optional(),
	appearance: AppearanceSchema.default({}),
	defaultAgent: z.string().default("build"),
	defaultModel: z
		.object({
			providerId: z.string(),
			modelId: z.string(),
		})
		.nullable()
		.default(null),
	/** Composite keys ("providerId:modelId") of models visible in the chat selector. */
	enabledModels: z.array(z.string()).default([]),
	/** Preferred editor for "Open in" actions. null = auto-detect first available. */
	defaultEditor: z.string().nullable().default(null),
	permission: PermissionSectionSchema.default({}),
	/** MCP server configurations keyed by server name. */
	mcp: z.record(z.string(), McpServerConfigSchema).default({}),

	// ── Provider configuration ──────────────────────────────
	/** Custom provider configurations and model overrides, keyed by provider ID. */
	provider: z.record(z.string(), ProviderConfigSchema).optional(),
	/** Provider IDs to disable (hides from provider list). */
	disabled_providers: z.array(z.string()).optional(),
	/** When set, ONLY these providers are enabled. All others are hidden. */
	enabled_providers: z.array(z.string()).optional(),
	/** Per-model visibility override. Key: "providerId:modelId", value: show/hide. */
	model_visibility: z.record(z.string(), z.enum(["show", "hide"])).optional(),

	// ── Reasoning configuration ────────────────────────────
	/** Default reasoning effort and summary settings. */
	reasoning: ReasoningConfigSchema.default({}),

	// ── Keybinding configuration ───────────────────────────
	/** User keybinding overrides. Keys are action IDs, values are keybind strings or "none". */
	keybindings: KeybindingOverridesSchema,

	// ── Formatter configuration ─────────────────────────────
	/** Formatter configurations keyed by name (e.g. "prettier", "biome"). */
	formatter: z.union([z.literal(false), z.record(z.string(), FormatterConfigSchema)]).optional(),
})

export type AppConfig = z.infer<typeof AppConfigSchema>

export const DEFAULT_CONFIG: AppConfig = AppConfigSchema.parse({})

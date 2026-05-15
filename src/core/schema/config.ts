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
	uiFont: z.string().nullable().default("inter"),
	/** Code/mono font family name. null = system default. */
	codeFont: z.string().nullable().default("geist-mono"),
	/** UI font size in pixels */
	uiFontSize: z.number().min(10).max(24).default(13),
	/** Code font size in pixels */
	codeFontSize: z.number().min(10).max(24).default(13),
	/** Contrast level: 0 = low, 50 = default, 100 = high */
	contrast: z.number().min(0).max(100).default(50),
	/** Enable translucent glass mode (macOS vibrancy). */
	glassMode: z.boolean().default(true),
	/** Which surfaces are translucent when glassMode is on.
	 *  "sidebar" — only the sidebar shows vibrancy, main panels stay opaque.
	 *  "full"    — sidebar + main + file panel + terminal all translucent. */
	glassLevel: z.enum(["sidebar", "full"]).default("sidebar"),
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

export const ReasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max", "ultrathink"])
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>

export const ReasoningSummarySchema = z.enum(["auto", "concise", "detailed"])
export type ReasoningSummary = z.infer<typeof ReasoningSummarySchema>

export const ReasoningConfigSchema = z.object({
	/** Default reasoning effort for models that support it. */
	effort: ReasoningEffortSchema.default("medium"),
	/** Reasoning summary mode (Codex endpoint only). */
	summary: ReasoningSummarySchema.default("auto"),
	/**
	 * When false, reasoning blocks are filtered out of the chat
	 * timeline entirely — neither standalone "Reasoned" rows nor the
	 * reasoning included in expanded work-log groups will render.
	 * Defaults to false: most users want a clean tool-action stream
	 * and can opt in via the chat-settings popover when they need
	 * the model's intermediate thinking.
	 */
	showInChat: z.boolean().default(false),
})

export type ReasoningConfig = z.infer<typeof ReasoningConfigSchema>

// ── Tools Configuration ──────────────────────────────────────

export const ToolsConfigSchema = z.object({
	/**
	 * When true, tool calls and work-log groups are shown after streaming
	 * completes. During streaming they are always visible regardless of this
	 * setting.
	 */
	showInChat: z.boolean().default(true),
})

export type ToolsConfig = z.infer<typeof ToolsConfigSchema>

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

// ── Claude Code Configuration ─────────────────────────────────

/**
 * Settings for the Claude Code CLI provider.
 *
 * The CLI itself is detected automatically from the user's machine — no
 * binary path / auth lives here (auth flows through `claude login`). The
 * single setting is a master enable flag so users can hide the synthetic
 * Claude Code provider from the model picker without uninstalling the CLI
 * (e.g. while testing other providers, or when the CLI's session leaks
 * into work they want to keep separate).
 */
export const ClaudeCodeSettingsSchema = z.object({
	/** Master toggle. Hides the provider entirely when false. */
	enabled: z.boolean().default(true),
})

export type ClaudeCodeSettings = z.infer<typeof ClaudeCodeSettingsSchema>

// ── OpenCode Configuration ────────────────────────────────────

/**
 * Settings for the OpenCode provider runtime.
 *
 * OpenCode is a separate process (CLI binary or remote server) that
 * proxies multiple upstream providers (OpenAI, Anthropic, etc.) under
 * a single connection. We connect to it via the @opencode-ai/sdk and
 * surface the upstream models it exposes inside Loop's model picker.
 *
 * Either spawn the local CLI (default — `opencode` on PATH) or point at
 * an externally-managed server with `serverUrl` + `serverPassword`.
 */
export const OpenCodeSettingsSchema = z.object({
	/** Master toggle. Hides the provider from the picker entirely when false. */
	enabled: z.boolean().default(true),
	/** Path to the OpenCode binary. Defaults to "opencode" (PATH lookup). */
	binaryPath: z.string().default("opencode"),
	/** Externally-managed OpenCode server URL. Empty string = spawn local. */
	serverUrl: z.string().default(""),
	/** Basic-auth password for the external server. Plain text on disk. */
	serverPassword: z.string().default(""),
})

export type OpenCodeSettings = z.infer<typeof OpenCodeSettingsSchema>

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

	// ── Tools configuration ─────────────────────────────────
	/** Tool call visibility in chat. */
	tools: ToolsConfigSchema.default({}),

	// ── Keybinding configuration ───────────────────────────
	/** User keybinding overrides. Keys are action IDs, values are keybind strings or "none". */
	keybindings: KeybindingOverridesSchema,

	// ── Skills configuration ────────────────────────────────
	/** Additional skill discovery paths and settings. */
	skills: z
		.object({
			/** Extra directories to scan for SKILL.md files (absolute or ~/relative). */
			paths: z.array(z.string()).default([]),
		})
		.default({}),

	// ── Claude Code configuration ───────────────────────────
	/** Claude Code CLI provider settings (currently just an enable flag). */
	claudeCode: ClaudeCodeSettingsSchema.default({}),

	// ── OpenCode configuration ──────────────────────────────
	/** OpenCode CLI/server connection settings. */
	opencode: OpenCodeSettingsSchema.default({}),

	// ── Worktree configuration ──────────────────────────────
	/** Worktree (sandbox) auto-cleanup settings. */
	worktree: z
		.object({
			/** Number of most-recent worktrees to keep globally. Older ones are auto-pruned. */
			autoDeleteLimit: z.number().int().min(1).max(100).default(20),
		})
		.default({}),

	// ── Formatter configuration ─────────────────────────────
	/** Formatter configurations keyed by name (e.g. "prettier", "biome"). */
	formatter: z.union([z.literal(false), z.record(z.string(), FormatterConfigSchema)]).optional(),
})

export type AppConfig = z.infer<typeof AppConfigSchema>

export const DEFAULT_CONFIG: AppConfig = AppConfigSchema.parse({})

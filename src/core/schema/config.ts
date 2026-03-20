import { z } from "zod"
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
	/** Translucent sidebar with backdrop blur */
	translucentSidebar: z.boolean().default(false),
	/** Contrast level: 0 = low, 50 = default, 100 = high */
	contrast: z.number().min(0).max(100).default(50),
})

export type Appearance = z.infer<typeof AppearanceSchema>

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
})

export type AppConfig = z.infer<typeof AppConfigSchema>

export const DEFAULT_CONFIG: AppConfig = AppConfigSchema.parse({})

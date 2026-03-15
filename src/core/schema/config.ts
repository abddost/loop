import { z } from "zod"
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
}

export const PermissionSectionSchema = z.object({
	approvalPolicy: ApprovalPolicySchema.default("default"),
	rules: PermissionConfigSchema.default(DEFAULT_PERMISSION_RULES),
})

export const AppConfigSchema = z.object({
	$schema: z.string().optional(),
	theme: z.enum(["dark", "light"]).default("dark"),
	defaultAgent: z.string().default("build"),
	defaultModel: z
		.object({
			providerId: z.string(),
			modelId: z.string(),
		})
		.nullable()
		.default(null),
	permission: PermissionSectionSchema.default({}),
})

export type AppConfig = z.infer<typeof AppConfigSchema>

export const DEFAULT_CONFIG: AppConfig = AppConfigSchema.parse({})

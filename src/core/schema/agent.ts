import { z } from "zod"
import { PermissionRulesetSchema } from "./permission"

export const AgentSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	type: z.enum(["primary", "subagent"]),
	hidden: z.boolean().optional(),
	topP: z.number().optional(),
	temperature: z.number().optional(),
	permission: PermissionRulesetSchema,
	model: z
		.object({
			modelId: z.string(),
			providerId: z.string(),
		})
		.optional(),
	option: z.string().optional(),
	prompt: z.string().optional(),
	options: z.record(z.string(), z.any()).optional(),
	steps: z.number().int().positive().optional(),
})

export type Agent = z.infer<typeof AgentSchema>

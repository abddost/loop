import { z } from "zod"

export const SandboxStatusSchema = z.enum(["creating", "ready", "failed", "removing"])
export type SandboxStatus = z.infer<typeof SandboxStatusSchema>

export const SandboxSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	name: z.string(),
	directory: z.string(),
	branch: z.string(),
	status: SandboxStatusSchema,
	createdAt: z.number(),
	updatedAt: z.number(),
})

export type Sandbox = z.infer<typeof SandboxSchema>

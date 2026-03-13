import { z } from "zod"

export const ProjectSchema = z.object({
	id: z.string(),
	name: z.string(),
	directory: z.string(),
	worktree: z.string().nullable(),
	vcs: z.enum(["git"]).nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
})

export type Project = z.infer<typeof ProjectSchema>

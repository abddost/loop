import { z } from "zod"

export const SkillSchema = z.object({
	/** Directory name used as unique identifier (e.g. "review-pr"). */
	id: z.string(),
	/** Human-readable name from YAML frontmatter. */
	name: z.string(),
	/** Description from YAML frontmatter. */
	description: z.string(),
	/** Absolute path to the SKILL.md file. */
	path: z.string(),
	/** Whether the skill is project-local or global. */
	scope: z.enum(["project", "global"]),
})

export type Skill = z.infer<typeof SkillSchema>

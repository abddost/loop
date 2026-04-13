import { z } from "zod"
import { createLogger } from "../../logger"
import { discover, load } from "../../skill"
import { Tool } from "../shape"

const log = createLogger("tool:skill")

/** Load a skill by name. Skills provide specialized instructions and workflows. */
export const skillTool: Tool.Shape = Tool.define("skill", (_agent) => {
	let skills: Array<{ id: string; name: string; description: string }> = []
	try {
		skills = discover()
	} catch {
		// Skills may not be available outside workspace context
	}

	const skillList =
		skills.length > 0
			? skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n")
			: "No skills currently available."

	const examples = skills
		.map((s) => `'${s.name}'`)
		.slice(0, 3)
		.join(", ")
	const hint = examples.length > 0 ? ` (e.g., ${examples})` : ""

	return {
		description: `Load a specialized skill that provides domain-specific instructions and workflows.
Use this tool when a task matches a skill's description.

Available skills:
${skillList}`,
		parameters: z.object({
			name: z.string().describe(`The skill name or ID to load${hint}`),
		}),
		async execute(ctx, input) {
			await ctx.ask({
				permission: "skill",
				patterns: [input.name],
				always: [input.name],
				metadata: { reason: `Load skill: ${input.name}` },
			})

			const result = load(input.name)
			if (!result) {
				return {
					output: `Skill "${input.name}" not found. Available skills: ${skills.map((s) => s.name).join(", ") || "none"}`,
				}
			}

			log.info("Loaded skill", { name: input.name, dir: result.dir })
			return { output: result.content }
		},
	}
})

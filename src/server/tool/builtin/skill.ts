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

	return {
		description: `Load a skill by name. Skills provide specialized instructions and workflows for specific tasks.
Use this tool when a task matches a skill's description.

Available skills:
${skillList}`,
		parameters: z.object({
			name: z.string().describe("The skill name or ID to load"),
		}),
		async execute(ctx, input) {
			await ctx.ask({
				permission: "skill",
				patterns: [input.name],
				always: [input.name],
				metadata: { reason: `Load skill: ${input.name}` },
			})

			const content = load(input.name)
			if (!content) {
				return {
					output: `Skill "${input.name}" not found. Available skills: ${skills.map((s) => s.name).join(", ")}`,
				}
			}
			log.info("Loaded skill", { name: input.name })
			return { output: content }
		},
	}
})

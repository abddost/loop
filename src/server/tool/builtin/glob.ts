import { resolve } from "node:path"
import { z } from "zod"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

/** Find files matching a glob pattern. Safe tool -- no permission required. */
export const globTool: Tool.Shape = {
	id: "glob",
	init() {
		return {
			description:
				"Find files matching a glob pattern in the workspace. Returns matching file paths sorted by modification time.",
			parameters: z.object({
				pattern: z.string().describe('Glob pattern to match (e.g., "**/*.ts", "src/**/*.tsx")'),
				path: z
					.string()
					.optional()
					.describe("Directory to search in, relative to workspace (default: workspace root)"),
			}),
			async execute(_ctx, input) {
				const searchDir = input.path ? resolve(Workspace.dir(), input.path) : Workspace.dir()

				const glob = new Bun.Glob(input.pattern)
				const matches: string[] = []

				for await (const entry of glob.scan({
					cwd: searchDir,
					dot: false,
				})) {
					matches.push(entry)
				}

				matches.sort()

				if (matches.length === 0) {
					return { output: `No files matched pattern: ${input.pattern}` }
				}

				return {
					output: matches.join("\n"),
					metadata: { count: matches.length },
				}
			},
		}
	},
}

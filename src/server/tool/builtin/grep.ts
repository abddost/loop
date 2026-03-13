import { resolve } from "node:path"
import { z } from "zod"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

/** Search file contents with regex using ripgrep. Safe tool -- no permission required. */
export const grepTool: Tool.Shape = {
	id: "grep",
	init() {
		return {
			description:
				"Search file contents using a regex pattern (powered by ripgrep). Returns matching lines with file paths and line numbers.",
			parameters: z.object({
				pattern: z.string().describe("Regex pattern to search for"),
				path: z
					.string()
					.optional()
					.describe(
						"Directory or file to search in, relative to workspace (default: workspace root)",
					),
				glob: z.string().optional().describe('Glob to filter files (e.g., "*.ts", "*.{js,jsx}")'),
				include: z.string().optional().describe('File type filter (e.g., "ts", "py")'),
			}),
			async execute(_ctx, input) {
				const searchPath = input.path ? resolve(Workspace.dir(), input.path) : Workspace.dir()

				const args = ["rg", "--no-heading", "--line-number", "--color=never"]

				if (input.glob) {
					args.push("--glob", input.glob)
				}
				if (input.include) {
					args.push("--type", input.include)
				}

				args.push("--", input.pattern, searchPath)

				const proc = Bun.spawn(args, {
					cwd: Workspace.dir(),
					stdout: "pipe",
					stderr: "pipe",
				})

				const output = await new Response(proc.stdout).text()
				const stderr = await new Response(proc.stderr).text()
				const exitCode = await proc.exited

				// rg exits with 1 when no matches found -- not an error
				if (exitCode === 1) {
					return { output: `No matches found for pattern: ${input.pattern}` }
				}

				if (exitCode !== 0 && exitCode !== 1) {
					return { output: `ripgrep error (exit ${exitCode}): ${stderr}` }
				}

				return {
					output: output.trimEnd(),
					metadata: {
						matchCount: output.split("\n").filter(Boolean).length,
					},
				}
			},
		}
	},
}

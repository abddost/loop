import { readdir, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

/** List directory contents. Safe tool -- no permission required. */
export const listTool: Tool.Shape = {
	id: "list",
	init() {
		return {
			description:
				"List files and directories in the given path. Returns entries with type indicators (/ for directories).",
			parameters: z.object({
				path: z.string().optional().describe("Relative path to list (default: workspace root)"),
			}),
			async execute(_ctx, input) {
				const dirPath = input.path ? resolve(Workspace.dir(), input.path) : Workspace.dir()

				let entries: string[]
				try {
					entries = await readdir(dirPath)
				} catch {
					return { output: `Directory not found: ${input.path ?? "."}` }
				}

				// Annotate directories with trailing /
				const annotated: string[] = []
				for (const entry of entries.sort()) {
					try {
						const s = await stat(resolve(dirPath, entry))
						annotated.push(s.isDirectory() ? `${entry}/` : entry)
					} catch {
						annotated.push(entry)
					}
				}

				if (annotated.length === 0) {
					return { output: "Directory is empty." }
				}

				return {
					output: annotated.join("\n"),
					metadata: { count: annotated.length },
				}
			},
		}
	},
}

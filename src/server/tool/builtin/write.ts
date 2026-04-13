import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { PathEscapeError, resolveInWorkspace } from "../../lib/filesystem"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"
import { computeDiff, trimDiff } from "./edit"

/** Write content to a file in the workspace. Requires permission. */
export const writeTool: Tool.Shape = {
	id: "write",
	init() {
		return {
			description:
				"Write content to a file in the workspace. Creates the file and any parent directories if they don't exist. Overwrites existing content. Generates a diff for review.",
			parameters: z.object({
				path: z.string().describe("Path to the file (absolute or relative to workspace)"),
				content: z.string().describe("The content to write to the file"),
			}),
			async execute(ctx, input) {
				await ctx.ask({
					permission: "write",
					patterns: [input.path],
					always: ["*"],
					metadata: { reason: `Write file: ${input.path}` },
				})

				let filePath: string
				try {
					filePath = resolveInWorkspace(Workspace.dir(), input.path)
				} catch (err) {
					if (err instanceof PathEscapeError) {
						return {
							output: `Error: ${err.message}`,
							metadata: { error: "path_escape" },
						}
					}
					throw err
				}

				// Read existing content if the file exists
				let before = ""
				let existed = false
				const file = Bun.file(filePath)
				if (await file.exists()) {
					before = await file.text()
					existed = true
				}

				// Normalize line endings
				const after = input.content.replace(/\r\n/g, "\n")

				await mkdir(dirname(filePath), { recursive: true })
				await Bun.write(filePath, after)

				const { diff, additions, deletions } = computeDiff(input.path, before, after)
				const type = existed ? "overwrite" : "create"

				ctx.metadata({
					metadata: {
						path: filePath,
						diff: trimDiff(diff),
						additions,
						deletions,
						existed,
						type,
					},
				})

				return {
					output: `Successfully wrote ${after.length} characters to ${input.path}`,
					metadata: {
						path: filePath,
						size: after.length,
						diff: trimDiff(diff),
						additions,
						deletions,
						existed,
						type,
					},
				}
			},
		}
	},
}

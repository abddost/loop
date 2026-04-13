import { stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { z } from "zod"
import { getRipgrepPath } from "../../lib/ripgrep"
import { Workspace } from "../../workspace"
import { Tool } from "../shape"

const MAX_RESULTS = 100

interface FileEntry {
	path: string
	mtime: number
}

async function globWithRipgrep(pattern: string, searchDir: string): Promise<FileEntry[]> {
	const rgPath = await getRipgrepPath()
	const proc = Bun.spawn([rgPath, "--files", "--glob", pattern, "--sort-files", searchDir], {
		stdout: "pipe",
		stderr: "pipe",
	})

	const stdout = await new Response(proc.stdout).text()
	const exitCode = await proc.exited

	// rg --files exits with 1 when no matches
	if (exitCode === 1 || !stdout.trim()) return []
	if (exitCode !== 0 && exitCode !== 1) return []

	const files = stdout.trim().split("\n").filter(Boolean)

	// Get modification times for sorting
	const entries: FileEntry[] = []
	for (const filePath of files) {
		try {
			const s = await stat(filePath)
			entries.push({ path: filePath, mtime: s.mtimeMs })
		} catch {
			// File may have been deleted between listing and stat
		}
	}

	return entries
}

async function globWithBun(pattern: string, searchDir: string): Promise<FileEntry[]> {
	const glob = new Bun.Glob(pattern)
	const entries: FileEntry[] = []

	for await (const entry of glob.scan({ cwd: searchDir, dot: false })) {
		const fullPath = resolve(searchDir, entry)
		try {
			const s = await stat(fullPath)
			entries.push({ path: fullPath, mtime: s.mtimeMs })
		} catch {
			// File may have been deleted between listing and stat
		}
	}

	return entries
}

/** Find files matching a glob pattern. Safe tool -- no permission required. */
export const globTool: Tool.Shape = Tool.define("glob", () => ({
	description: [
		"Fast file pattern matching tool that works with any codebase size.",
		'Supports glob patterns like "**/*.js" or "src/**/*.ts".',
		"Returns matching file paths sorted by modification time (newest first).",
		"Limited to 100 results.",
	].join(" "),
	parameters: z.object({
		pattern: z.string().describe('Glob pattern to match (e.g., "**/*.ts", "src/**/*.tsx")'),
		path: z
			.string()
			.optional()
			.describe(
				"Directory to search in (absolute or relative to workspace, default: workspace root)",
			),
	}),
	async execute(ctx, input) {
		await ctx.ask({
			permission: "glob",
			patterns: [input.pattern],
			always: ["*"],
		})

		const searchDir = input.path
			? isAbsolute(input.path)
				? input.path
				: resolve(Workspace.dir(), input.path)
			: Workspace.dir()

		// Use managed ripgrep, fall back to Bun.Glob if download fails
		let entries: FileEntry[]
		try {
			entries = await globWithRipgrep(input.pattern, searchDir)
		} catch {
			entries = await globWithBun(input.pattern, searchDir)
		}

		// Sort by modification time (newest first)
		entries.sort((a, b) => b.mtime - a.mtime)

		if (entries.length === 0) {
			return { output: `No files matched pattern: ${input.pattern}` }
		}

		const totalCount = entries.length
		const truncated = totalCount > MAX_RESULTS
		const shown = entries.slice(0, MAX_RESULTS)

		let output = shown.map((e) => e.path).join("\n")
		if (truncated) {
			output += `\n\n[${totalCount - MAX_RESULTS} more files not shown. Use a more specific pattern to narrow results.]`
		}

		return {
			output,
			metadata: {
				count: shown.length,
				totalCount,
				truncated,
			},
		}
	},
}))

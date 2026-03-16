import { stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { z } from "zod"
import { Workspace } from "../../workspace"
import { Tool } from "../shape"

const MAX_LINE_LENGTH = 2000
const MAX_MATCHES = 100

interface GrepMatch {
	file: string
	line: number
	text: string
	mtime: number
}

function truncateLine(line: string): string {
	if (line.length <= MAX_LINE_LENGTH) return line
	return `${line.slice(0, MAX_LINE_LENGTH)}...`
}

function groupByFile(matches: GrepMatch[]): Map<string, GrepMatch[]> {
	const groups = new Map<string, GrepMatch[]>()
	for (const match of matches) {
		const group = groups.get(match.file)
		if (group) {
			group.push(match)
		} else {
			groups.set(match.file, [match])
		}
	}
	return groups
}

/** Search file contents using regex with ripgrep. Safe tool -- no permission required. */
export const grepTool: Tool.Shape = Tool.define("grep", () => ({
	description: [
		"Search file contents using a regex pattern powered by ripgrep.",
		"Returns matching lines grouped by file, sorted by file modification time (newest first).",
		"Supports regex syntax and optional file glob filtering.",
		"Limited to 100 matches.",
	].join(" "),
	parameters: z.object({
		pattern: z.string().describe("Regex pattern to search for"),
		path: z
			.string()
			.optional()
			.describe(
				"Directory or file to search in (absolute or relative to workspace, default: workspace root)",
			),
		include: z
			.string()
			.optional()
			.describe('Glob pattern to filter files (e.g., "*.ts", "*.{js,jsx}")'),
	}),
	async execute(ctx, input) {
		await ctx.ask({
			permission: "grep",
			patterns: [input.pattern],
			always: ["*"],
		})

		const searchPath = input.path
			? isAbsolute(input.path)
				? input.path
				: resolve(Workspace.dir(), input.path)
			: Workspace.dir()

		const args = [
			"rg",
			"--no-heading",
			"--line-number",
			"--color=never",
			"--field-match-separator",
			"\t",
		]

		if (input.include) {
			args.push("--glob", input.include)
		}

		args.push("--", input.pattern, searchPath)

		const proc = Bun.spawn(args, {
			cwd: Workspace.dir(),
			stdout: "pipe",
			stderr: "pipe",
		})

		const stdout = await new Response(proc.stdout).text()
		const stderr = await new Response(proc.stderr).text()
		const exitCode = await proc.exited

		// exit 1 = no matches found
		if (exitCode === 1) {
			return { output: `No matches found for pattern: ${input.pattern}` }
		}

		// exit 2 = partial error (some paths inaccessible), may still have matches
		const warnings: string[] = []
		if (exitCode === 2) {
			const warnLines = stderr
				.split("\n")
				.filter(Boolean)
				.filter((l) => !l.startsWith("rg: "))
			if (warnLines.length > 0) {
				warnings.push(...warnLines)
			}
			// If no output despite exit 2, it's a real error
			if (!stdout.trim()) {
				return { output: `ripgrep error: ${stderr.trim()}` }
			}
		}

		if (exitCode !== 0 && exitCode !== 1 && exitCode !== 2) {
			return { output: `ripgrep error (exit ${exitCode}): ${stderr.trim()}` }
		}

		// Parse ripgrep output
		const rawLines = stdout.trim().split("\n").filter(Boolean)
		const matches: GrepMatch[] = []
		const fileModTimes = new Map<string, number>()

		for (const rawLine of rawLines) {
			// Format: filepath\tlinenum\tmatch_text (with --field-match-separator)
			const firstTab = rawLine.indexOf("\t")
			if (firstTab === -1) continue

			const secondTab = rawLine.indexOf("\t", firstTab + 1)
			if (secondTab === -1) continue

			const file = rawLine.slice(0, firstTab)
			const lineStr = rawLine.slice(firstTab + 1, secondTab)
			const text = rawLine.slice(secondTab + 1)

			const lineNum = Number.parseInt(lineStr, 10)
			if (Number.isNaN(lineNum)) continue

			// Cache file modification times
			let mtime = fileModTimes.get(file)
			if (mtime === undefined) {
				try {
					const s = await stat(file)
					mtime = s.mtimeMs
				} catch {
					mtime = 0
				}
				fileModTimes.set(file, mtime)
			}

			matches.push({
				file,
				line: lineNum,
				text: truncateLine(text),
				mtime,
			})
		}

		if (matches.length === 0) {
			return { output: `No matches found for pattern: ${input.pattern}` }
		}

		// Sort files by modification time (newest first)
		const filesByMtime = [...fileModTimes.entries()].sort((a, b) => b[1] - a[1])
		const fileOrder = new Map(filesByMtime.map(([f], i) => [f, i]))

		matches.sort((a, b) => {
			const orderA = fileOrder.get(a.file) ?? 0
			const orderB = fileOrder.get(b.file) ?? 0
			if (orderA !== orderB) return orderA - orderB
			return a.line - b.line
		})

		const totalMatches = matches.length
		const truncated = totalMatches > MAX_MATCHES
		const shown = matches.slice(0, MAX_MATCHES)

		// Group by file for display
		const grouped = groupByFile(shown)
		const outputParts: string[] = []

		for (const [file, fileMatches] of grouped) {
			outputParts.push(file)
			for (const m of fileMatches) {
				outputParts.push(`${m.line}: ${m.text}`)
			}
			outputParts.push("")
		}

		let output = outputParts.join("\n").trimEnd()

		if (truncated) {
			output += `\n\n[${totalMatches - MAX_MATCHES} more matches not shown. Use a more specific pattern to narrow results.]`
		}

		if (warnings.length > 0) {
			output += `\n\nWarnings:\n${warnings.join("\n")}`
		}

		return {
			output,
			metadata: {
				matchCount: shown.length,
				totalMatches,
				fileCount: grouped.size,
				truncated,
			},
		}
	},
}))

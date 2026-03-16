import { stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { createTwoFilesPatch, diffLines } from "diff"
import { z } from "zod"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

// ── Levenshtein Distance ────────────────────────────

function levenshtein(a: string, b: string): number {
	const la = a.length
	const lb = b.length
	const dp: number[][] = Array.from({ length: la + 1 }, () => Array(lb + 1).fill(0))
	for (let i = 0; i <= la; i++) dp[i][0] = i
	for (let j = 0; j <= lb; j++) dp[0][j] = j
	for (let i = 1; i <= la; i++) {
		for (let j = 1; j <= lb; j++) {
			dp[i][j] =
				a[i - 1] === b[j - 1]
					? dp[i - 1][j - 1]
					: 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
		}
	}
	return dp[la][lb]
}

function similarity(a: string, b: string): number {
	if (a === b) return 1
	const maxLen = Math.max(a.length, b.length)
	if (maxLen === 0) return 1
	return 1 - levenshtein(a, b) / maxLen
}

// ── Normalize Line Endings ──────────────────────────

function normalizeLineEndings(s: string): string {
	return s.replace(/\r\n/g, "\n")
}

// ── trimDiff ────────────────────────────────────────

/**
 * Remove common leading whitespace from diff content lines (lines starting with +, -, or space).
 * Header lines (@@, ---, +++) are left untouched.
 */
export function trimDiff(diff: string): string {
	const lines = diff.split("\n")
	const contentLines = lines.filter(
		(l) => l.startsWith(" ") || l.startsWith("+") || l.startsWith("-"),
	)
	// Find the minimum indentation among content portions (after the leading diff char)
	let minIndent = Number.POSITIVE_INFINITY
	for (const line of contentLines) {
		const content = line.slice(1) // remove leading +/-/space
		if (content.trim().length === 0) continue
		const indent = content.length - content.trimStart().length
		minIndent = Math.min(minIndent, indent)
	}
	if (!Number.isFinite(minIndent) || minIndent === 0) return diff
	return lines
		.map((line) => {
			if (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-")) {
				return line[0] + line.slice(1 + minIndent)
			}
			return line
		})
		.join("\n")
}

// ── Diff Helpers ────────────────────────────────────

export function computeDiff(
	filePath: string,
	before: string,
	after: string,
): { diff: string; additions: number; deletions: number } {
	const patch = createTwoFilesPatch(filePath, filePath, before, after, "", "")
	const changes = diffLines(before, after)
	let additions = 0
	let deletions = 0
	for (const change of changes) {
		const lineCount = change.count ?? 0
		if (change.added) additions += lineCount
		else if (change.removed) deletions += lineCount
	}
	return { diff: patch, additions, deletions }
}

// ── File Lock ───────────────────────────────────────

const fileLocks = new Map<string, Promise<void>>()

async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
	while (fileLocks.has(path)) {
		await fileLocks.get(path)
	}
	let release: () => void
	const lock = new Promise<void>((r) => {
		release = r
	})
	fileLocks.set(path, lock)
	try {
		return await fn()
	} finally {
		fileLocks.delete(path)
		release!()
	}
}

// ── Replacer Interface ─────────────────────────────

interface ReplaceResult {
	content: string
	matchCount: number
}

interface Replacer {
	name: string
	replace(
		content: string,
		oldStr: string,
		newStr: string,
		replaceAll: boolean,
	): ReplaceResult | null
}

// ── 1. SimpleReplacer ──────────────────────────────

const SimpleReplacer: Replacer = {
	name: "SimpleReplacer",
	replace(content, oldStr, newStr, replaceAll) {
		if (!content.includes(oldStr)) return null
		const count = content.split(oldStr).length - 1
		if (!replaceAll && count > 1) return null
		const result = replaceAll ? content.replaceAll(oldStr, newStr) : content.replace(oldStr, newStr)
		return { content: result, matchCount: replaceAll ? count : 1 }
	},
}

// ── 2. LineTrimmedReplacer ─────────────────────────

const LineTrimmedReplacer: Replacer = {
	name: "LineTrimmedReplacer",
	replace(content, oldStr, newStr, replaceAll) {
		const contentLines = content.split("\n")
		const oldLines = oldStr.split("\n")
		const trimmedOld = oldLines.map((l) => l.trim())

		const matches: number[] = []
		for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
			let match = true
			for (let j = 0; j < oldLines.length; j++) {
				if (contentLines[i + j].trim() !== trimmedOld[j]) {
					match = false
					break
				}
			}
			if (match) matches.push(i)
		}

		if (matches.length === 0) return null
		if (!replaceAll && matches.length > 1) return null

		const indicesToReplace = replaceAll ? matches : [matches[0]]
		const replaced = new Set<number>()
		const resultLines: string[] = []

		for (let i = 0; i < contentLines.length; i++) {
			const matchIdx = indicesToReplace.find(
				(m) => i >= m && i < m + oldLines.length && !replaced.has(m),
			)
			if (matchIdx !== undefined && i === matchIdx) {
				resultLines.push(newStr)
				replaced.add(matchIdx)
			} else if (
				indicesToReplace.some((m) => i > m && i < m + oldLines.length && replaced.has(m))
			) {
				// Skip lines that are part of a replaced match
			} else {
				resultLines.push(contentLines[i])
			}
		}

		return { content: resultLines.join("\n"), matchCount: indicesToReplace.length }
	},
}

// ── 3. BlockAnchorReplacer ─────────────────────────

const BlockAnchorReplacer: Replacer = {
	name: "BlockAnchorReplacer",
	replace(content, oldStr, newStr, replaceAll) {
		const contentLines = content.split("\n")
		const oldLines = oldStr.split("\n")
		if (oldLines.length < 3) return null

		const firstLine = oldLines[0].trim()
		const lastLine = oldLines[oldLines.length - 1].trim()
		if (!firstLine || !lastLine) return null

		const matches: number[] = []
		for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
			if (contentLines[i].trim() !== firstLine) continue
			if (contentLines[i + oldLines.length - 1].trim() !== lastLine) continue

			// Check middle content similarity
			const middleOld = oldLines.slice(1, -1).join("\n")
			const middleContent = contentLines.slice(i + 1, i + oldLines.length - 1).join("\n")
			if (similarity(middleOld, middleContent) >= 0.6) {
				matches.push(i)
			}
		}

		if (matches.length === 0) return null
		if (!replaceAll && matches.length > 1) return null

		const indicesToReplace = replaceAll ? matches : [matches[0]]
		const newLines = newStr.split("\n")
		let offset = 0
		const resultLines = [...contentLines]

		for (const matchStart of indicesToReplace) {
			const adjustedStart = matchStart + offset
			resultLines.splice(adjustedStart, oldLines.length, ...newLines)
			offset += newLines.length - oldLines.length
		}

		return { content: resultLines.join("\n"), matchCount: indicesToReplace.length }
	},
}

// ── 4. WhitespaceNormalizedReplacer ────────────────

const WhitespaceNormalizedReplacer: Replacer = {
	name: "WhitespaceNormalizedReplacer",
	replace(content, oldStr, newStr, replaceAll) {
		const normalize = (s: string) => s.replace(/\s+/g, " ").trim()
		const normalizedContent = normalize(content)
		const normalizedOld = normalize(oldStr)

		if (!normalizedContent.includes(normalizedOld)) return null

		// Build a mapping from normalized positions to original positions
		const normToOrig: number[] = []
		let inWs = false
		const trimmedStart = content.length - content.trimStart().length
		for (let oPos = trimmedStart; oPos < content.length; oPos++) {
			if (/\s/.test(content[oPos])) {
				if (!inWs && normToOrig.length > 0) {
					normToOrig.push(oPos)
					inWs = true
				}
			} else {
				inWs = false
				normToOrig.push(oPos)
			}
		}
		// Sentinel at the end
		normToOrig.push(content.length)

		const matches: Array<{ start: number; end: number }> = []
		let searchFrom = 0
		while (true) {
			const normIdx = normalizedContent.indexOf(normalizedOld, searchFrom)
			if (normIdx === -1) break
			searchFrom = normIdx + 1

			const origStart = normToOrig[normIdx] ?? 0
			const normEnd = normIdx + normalizedOld.length
			const origEnd = normToOrig[normEnd] ?? content.length

			matches.push({ start: origStart, end: origEnd })
			if (!replaceAll) break
		}

		if (matches.length === 0) return null
		if (!replaceAll && matches.length > 1) return null

		let result = content
		let offset = 0
		const indicesToReplace = replaceAll ? matches : [matches[0]]
		for (const m of indicesToReplace) {
			result = result.slice(0, m.start + offset) + newStr + result.slice(m.end + offset)
			offset += newStr.length - (m.end - m.start)
		}

		return { content: result, matchCount: indicesToReplace.length }
	},
}

// ── 5. IndentationFlexibleReplacer ─────────────────

const IndentationFlexibleReplacer: Replacer = {
	name: "IndentationFlexibleReplacer",
	replace(content, oldStr, newStr, replaceAll) {
		const removeCommonIndent = (s: string): string => {
			const lines = s.split("\n")
			const nonEmptyLines = lines.filter((l) => l.trim().length > 0)
			if (nonEmptyLines.length === 0) return s
			const minIndent = Math.min(...nonEmptyLines.map((l) => l.length - l.trimStart().length))
			if (minIndent === 0) return s
			return lines.map((l) => (l.trim().length > 0 ? l.slice(minIndent) : l)).join("\n")
		}

		const dedentedContent = removeCommonIndent(content)
		const dedentedOld = removeCommonIndent(oldStr)

		if (!dedentedContent.includes(dedentedOld)) return null

		const count = dedentedContent.split(dedentedOld).length - 1
		if (!replaceAll && count > 1) return null

		// Find the match position in dedented content, then apply to original
		const contentLines = content.split("\n")
		const oldLines = oldStr.split("\n")
		const dedentedOldLines = dedentedOld.split("\n")

		const matches: number[] = []
		for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
			let match = true
			for (let j = 0; j < dedentedOldLines.length; j++) {
				if (contentLines[i + j].trimStart() !== dedentedOldLines[j].trimStart()) {
					match = false
					break
				}
			}
			if (match) matches.push(i)
		}

		if (matches.length === 0) return null
		if (!replaceAll && matches.length > 1) return null

		const indicesToReplace = replaceAll ? matches : [matches[0]]
		const newLines = newStr.split("\n")
		let offset = 0
		const resultLines = [...contentLines]

		for (const matchStart of indicesToReplace) {
			const adjustedStart = matchStart + offset
			// Detect the indentation of the first matched line
			const originalLine = contentLines[matchStart]
			const existingIndent = originalLine.length - originalLine.trimStart().length
			const indentStr = originalLine.slice(0, existingIndent)

			// Apply the existing indentation to new lines
			const indentedNewLines = newLines.map((l, idx) => {
				if (idx === 0) return indentStr + l.trimStart()
				if (l.trim().length === 0) return l
				return indentStr + l.trimStart()
			})

			resultLines.splice(adjustedStart, oldLines.length, ...indentedNewLines)
			offset += indentedNewLines.length - oldLines.length
		}

		return { content: resultLines.join("\n"), matchCount: indicesToReplace.length }
	},
}

// ── 6. EscapeNormalizedReplacer ────────────────────

const EscapeNormalizedReplacer: Replacer = {
	name: "EscapeNormalizedReplacer",
	replace(content, oldStr, newStr, replaceAll) {
		// Normalize escape sequences: replace literal \n, \t, \r with actual characters
		const normalizeEscapes = (s: string): string =>
			s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")

		const normalizedOld = normalizeEscapes(oldStr)
		if (normalizedOld === oldStr) return null // No escapes to normalize

		if (!content.includes(normalizedOld)) return null

		const count = content.split(normalizedOld).length - 1
		if (!replaceAll && count > 1) return null

		const result = replaceAll
			? content.replaceAll(normalizedOld, newStr)
			: content.replace(normalizedOld, newStr)

		return { content: result, matchCount: replaceAll ? count : 1 }
	},
}

// ── 7. TrimmedBoundaryReplacer ─────────────────────

const TrimmedBoundaryReplacer: Replacer = {
	name: "TrimmedBoundaryReplacer",
	replace(content, oldStr, newStr, replaceAll) {
		const trimmedOld = oldStr.trim()
		if (trimmedOld === oldStr) return null // Nothing to trim
		if (!content.includes(trimmedOld)) return null

		const count = content.split(trimmedOld).length - 1
		if (!replaceAll && count > 1) return null

		const result = replaceAll
			? content.replaceAll(trimmedOld, newStr)
			: content.replace(trimmedOld, newStr)

		return { content: result, matchCount: replaceAll ? count : 1 }
	},
}

// ── 8. ContextAwareReplacer ────────────────────────

const ContextAwareReplacer: Replacer = {
	name: "ContextAwareReplacer",
	replace(content, oldStr, newStr, replaceAll) {
		const contentLines = content.split("\n")
		const oldLines = oldStr.split("\n")
		if (oldLines.length < 2) return null

		const firstLine = oldLines[0].trim()
		const lastLine = oldLines[oldLines.length - 1].trim()
		if (!firstLine || !lastLine) return null

		const matches: number[] = []
		for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
			if (contentLines[i].trim() !== firstLine) continue
			if (contentLines[i + oldLines.length - 1].trim() !== lastLine) continue

			// Check overall similarity with 50% threshold
			const original = contentLines.slice(i, i + oldLines.length).join("\n")
			if (similarity(oldStr, original) >= 0.5) {
				matches.push(i)
			}
		}

		if (matches.length === 0) return null
		if (!replaceAll && matches.length > 1) return null

		const indicesToReplace = replaceAll ? matches : [matches[0]]
		const newLines = newStr.split("\n")
		let offset = 0
		const resultLines = [...contentLines]

		for (const matchStart of indicesToReplace) {
			const adjustedStart = matchStart + offset
			resultLines.splice(adjustedStart, oldLines.length, ...newLines)
			offset += newLines.length - oldLines.length
		}

		return { content: resultLines.join("\n"), matchCount: indicesToReplace.length }
	},
}

// ── 9. MultiOccurrenceReplacer ─────────────────────

const MultiOccurrenceReplacer: Replacer = {
	name: "MultiOccurrenceReplacer",
	replace(content, oldStr, newStr, replaceAll) {
		if (!replaceAll) return null
		if (!content.includes(oldStr)) return null

		const count = content.split(oldStr).length - 1
		if (count <= 1) return null

		return { content: content.replaceAll(oldStr, newStr), matchCount: count }
	},
}

// ── Replacer Chain ──────────────────────────────────

const replacers: Replacer[] = [
	SimpleReplacer,
	LineTrimmedReplacer,
	BlockAnchorReplacer,
	WhitespaceNormalizedReplacer,
	IndentationFlexibleReplacer,
	EscapeNormalizedReplacer,
	TrimmedBoundaryReplacer,
	ContextAwareReplacer,
	MultiOccurrenceReplacer,
]

/**
 * Try each replacer in order until one succeeds.
 * Exported for reuse by multiedit tool.
 */
export function replace(
	content: string,
	oldStr: string,
	newStr: string,
	replaceAll: boolean,
): ReplaceResult | null {
	for (const replacer of replacers) {
		const result = replacer.replace(content, oldStr, newStr, replaceAll)
		if (result) return result
	}
	return null
}

// ── Resolve Path ────────────────────────────────────

function resolvePath(inputPath: string): string {
	return isAbsolute(inputPath) ? inputPath : resolve(Workspace.dir(), inputPath)
}

// ── Edit Tool ───────────────────────────────────────

/** Edit a file with string replacement using 9 replacer strategies. Requires permission. */
export const editTool: Tool.Shape = {
	id: "edit",
	init() {
		return {
			description:
				"Edit a file by replacing a string. Uses multiple fuzzy matching strategies. The old_string should appear in the file. If old_string is empty, the file is created with new_string. If replace_all is false (default), old_string must be unique.",
			parameters: z.object({
				path: z.string().describe("Path to the file (absolute or relative to workspace)"),
				old_string: z.string().describe("The text to find and replace"),
				new_string: z.string().describe("The text to replace it with"),
				replace_all: z.boolean().optional().describe("Replace all occurrences (default: false)"),
			}),
			async execute(ctx, input) {
				const filePath = resolvePath(input.path)
				const oldString = normalizeLineEndings(input.old_string)
				const newString = normalizeLineEndings(input.new_string)
				const doReplaceAll = input.replace_all ?? false

				// Handle "create new file" when oldString is empty
				if (oldString === "") {
					await ctx.ask({
						permission: "write",
						patterns: [input.path],
						always: ["*"],
						metadata: { reason: `Create file: ${input.path}` },
					})

					const { mkdir } = await import("node:fs/promises")
					const { dirname } = await import("node:path")
					await mkdir(dirname(filePath), { recursive: true })
					await Bun.write(filePath, newString)

					const { diff, additions, deletions } = computeDiff(input.path, "", newString)
					ctx.metadata({
						metadata: {
							path: filePath,
							diff: trimDiff(diff),
							additions,
							deletions,
							type: "create",
						},
					})

					return {
						output: `Created file ${input.path} (${newString.length} characters)`,
						metadata: {
							path: filePath,
							diff: trimDiff(diff),
							additions,
							deletions,
						},
					}
				}

				// Validate oldString !== newString
				if (oldString === newString) {
					return { output: "old_string and new_string are identical. No changes needed." }
				}

				// Validate file exists and is not a directory
				let fileStat: Awaited<ReturnType<typeof stat>>
				try {
					fileStat = await stat(filePath)
				} catch {
					return { output: `File not found: ${input.path}` }
				}
				if (fileStat.isDirectory()) {
					return { output: `Path is a directory, not a file: ${input.path}` }
				}

				await ctx.ask({
					permission: "edit",
					patterns: [input.path],
					always: ["*"],
					metadata: { reason: `Edit file: ${input.path}` },
				})

				return withFileLock(filePath, async () => {
					const file = Bun.file(filePath)
					const content = normalizeLineEndings(await file.text())

					const result = replace(content, oldString, newString, doReplaceAll)
					if (!result) {
						return {
							output: `old_string not found in ${input.path}. Make sure the string matches the file content, including whitespace and indentation.`,
						}
					}

					await Bun.write(filePath, result.content)

					const { diff, additions, deletions } = computeDiff(input.path, content, result.content)

					ctx.metadata({
						metadata: {
							path: filePath,
							diff: trimDiff(diff),
							additions,
							deletions,
							matchCount: result.matchCount,
							type: "edit",
						},
					})

					const matchInfo =
						result.matchCount > 1 ? ` (${result.matchCount} occurrences replaced)` : ""
					return {
						output: `Successfully edited ${input.path}${matchInfo}`,
						metadata: {
							path: filePath,
							diff: trimDiff(diff),
							additions,
							deletions,
							matchCount: result.matchCount,
						},
					}
				})
			},
		}
	},
}

import { mkdir, rm, stat } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { z } from "zod"
import { Workspace } from "../../workspace"
import { bus } from "../../workspace/bus"
import type { Tool } from "../shape"
import { computeDiff, trimDiff } from "./edit"

// ── Patch Types ─────────────────────────────────────

interface AddFileOp {
	type: "add"
	path: string
	content: string
}

interface UpdateFileOp {
	type: "update"
	path: string
	hunks: Hunk[]
	moveTo?: string
}

interface DeleteFileOp {
	type: "delete"
	path: string
}

type PatchOp = AddFileOp | UpdateFileOp | DeleteFileOp

interface Hunk {
	contextLine: string
	changes: HunkChange[]
}

interface HunkChange {
	type: "add" | "remove" | "context"
	line: string
}

// ── Patch Parser ────────────────────────────────────

function parsePatch(patch: string): PatchOp[] {
	const lines = patch.replace(/\r\n/g, "\n").split("\n")
	const ops: PatchOp[] = []

	let i = 0
	// Find the start marker
	while (i < lines.length && lines[i].trim() !== "*** Begin Patch") {
		i++
	}
	if (i >= lines.length) {
		throw new Error("Missing '*** Begin Patch' marker")
	}
	i++ // skip the marker

	while (i < lines.length) {
		const line = lines[i]

		if (line.trim() === "*** End Patch") break

		if (line.startsWith("*** Add File: ")) {
			const path = line.slice("*** Add File: ".length).trim()
			i++
			const contentLines: string[] = []
			while (i < lines.length && !lines[i].startsWith("***")) {
				if (lines[i].startsWith("+")) {
					contentLines.push(lines[i].slice(1))
				}
				i++
			}
			ops.push({ type: "add", path, content: contentLines.join("\n") })
		} else if (line.startsWith("*** Delete File: ")) {
			const path = line.slice("*** Delete File: ".length).trim()
			ops.push({ type: "delete", path })
			i++
		} else if (line.startsWith("*** Update File: ")) {
			const path = line.slice("*** Update File: ".length).trim()
			i++

			// Check for optional "Move to:" directive
			let moveTo: string | undefined
			if (i < lines.length && lines[i].startsWith("*** Move to: ")) {
				moveTo = lines[i].slice("*** Move to: ".length).trim()
				i++
			}

			const hunks: Hunk[] = []
			while (i < lines.length && !lines[i].startsWith("***")) {
				if (lines[i].startsWith("@@ ")) {
					const contextLine = lines[i].slice(3)
					i++
					const changes: HunkChange[] = []
					while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("***")) {
						const changeLine = lines[i]
						if (changeLine.startsWith("+")) {
							changes.push({ type: "add", line: changeLine.slice(1) })
						} else if (changeLine.startsWith("-")) {
							changes.push({ type: "remove", line: changeLine.slice(1) })
						} else if (changeLine.startsWith(" ")) {
							changes.push({ type: "context", line: changeLine.slice(1) })
						} else {
							// Treat as context with no prefix
							changes.push({ type: "context", line: changeLine })
						}
						i++
					}
					hunks.push({ contextLine, changes })
				} else {
					i++
				}
			}
			ops.push({ type: "update", path, hunks, moveTo })
		} else {
			i++
		}
	}

	return ops
}

// ── Apply Hunks ─────────────────────────────────────

function applyHunks(content: string, hunks: Hunk[]): string {
	const lines = content.split("\n")
	const result: string[] = [...lines]

	for (const hunk of hunks) {
		// Find the context line in the result
		let contextIdx = -1
		for (let i = 0; i < result.length; i++) {
			if (result[i].trim() === hunk.contextLine.trim()) {
				contextIdx = i
				break
			}
		}

		if (contextIdx === -1) {
			throw new Error(`Could not find context line: ${hunk.contextLine}`)
		}

		// Apply changes starting after the context line
		let pos = contextIdx + 1
		for (const change of hunk.changes) {
			if (change.type === "context") {
				// Verify context matches and move forward
				if (pos < result.length && result[pos].trim() === change.line.trim()) {
					pos++
				} else {
					// Try to find the context line nearby
					let found = false
					for (let j = pos; j < Math.min(pos + 5, result.length); j++) {
						if (result[j].trim() === change.line.trim()) {
							pos = j + 1
							found = true
							break
						}
					}
					if (!found) pos++
				}
			} else if (change.type === "remove") {
				// Verify we're removing the right line
				if (pos < result.length && result[pos].trim() === change.line.trim()) {
					result.splice(pos, 1)
				} else {
					// Try to find the line nearby
					let found = false
					for (let j = pos; j < Math.min(pos + 5, result.length); j++) {
						if (result[j].trim() === change.line.trim()) {
							result.splice(j, 1)
							pos = j
							found = true
							break
						}
					}
					if (!found) {
						throw new Error(`Could not find line to remove: ${change.line}`)
					}
				}
			} else if (change.type === "add") {
				result.splice(pos, 0, change.line)
				pos++
			}
		}
	}

	return result.join("\n")
}

function resolvePath(inputPath: string): string {
	return isAbsolute(inputPath) ? inputPath : resolve(Workspace.dir(), inputPath)
}

// ── Validate Ops ────────────────────────────────────

async function validateOps(ops: PatchOp[]): Promise<string | null> {
	for (const op of ops) {
		const filePath = resolvePath(op.path)
		if (op.type === "add") {
			const file = Bun.file(filePath)
			if (await file.exists()) {
				return `File already exists (Add File): ${op.path}`
			}
		} else if (op.type === "update" || op.type === "delete") {
			try {
				const s = await stat(filePath)
				if (s.isDirectory()) {
					return `Path is a directory: ${op.path}`
				}
			} catch {
				return `File not found: ${op.path}`
			}
		}
	}
	return null
}

// ── Apply Patch Tool ────────────────────────────────

export const applyPatchTool: Tool.Shape = {
	id: "apply_patch",
	init() {
		return {
			description:
				"Apply a multi-file patch. Supports adding, updating, deleting, and moving files. Uses a custom patch format with *** Begin Patch / *** End Patch envelope.",
			parameters: z.object({
				patch: z.string().describe(
					`The patch content in the format:
*** Begin Patch
*** Add File: path
+content line
*** Update File: path
@@ context line
-old line
+new line
 context line
*** Delete File: path
*** End Patch`,
				),
			}),
			async execute(ctx, input) {
				let ops: PatchOp[]
				try {
					ops = parsePatch(input.patch)
				} catch (e) {
					return {
						output: `Failed to parse patch: ${e instanceof Error ? e.message : String(e)}`,
					}
				}

				if (ops.length === 0) {
					return { output: "Patch contains no operations." }
				}

				// Validate all operations before applying
				const validationError = await validateOps(ops)
				if (validationError) {
					return { output: `Patch validation failed: ${validationError}` }
				}

				// Build combined diff for permission display
				const affectedPaths = ops.map((op) => op.path)
				await ctx.ask({
					permission: "edit",
					patterns: affectedPaths,
					always: ["*"],
					metadata: {
						reason: `Apply patch to ${ops.length} file(s): ${affectedPaths.join(", ")}`,
					},
				})

				// Apply each operation
				const fileResults: Array<{
					path: string
					type: string
					diff: string
					before: string
					after: string
					additions: number
					deletions: number
				}> = []

				let totalAdditions = 0
				let totalDeletions = 0

				for (const op of ops) {
					const filePath = resolvePath(op.path)

					if (op.type === "add") {
						await mkdir(dirname(filePath), { recursive: true })
						await Bun.write(filePath, op.content)

						bus().emit("file:changed", {
							path: relative(Workspace.dir(), filePath),
							event: "add",
						})

						const { diff, additions, deletions } = computeDiff(op.path, "", op.content)
						totalAdditions += additions
						totalDeletions += deletions
						fileResults.push({
							path: op.path,
							type: "add",
							diff: trimDiff(diff),
							before: "",
							after: op.content,
							additions,
							deletions,
						})
					} else if (op.type === "delete") {
						const before = await Bun.file(filePath).text()
						await rm(filePath)

						bus().emit("file:changed", {
							path: relative(Workspace.dir(), filePath),
							event: "unlink",
						})

						const { diff, additions, deletions } = computeDiff(op.path, before, "")
						totalAdditions += additions
						totalDeletions += deletions
						fileResults.push({
							path: op.path,
							type: "delete",
							diff: trimDiff(diff),
							before,
							after: "",
							additions,
							deletions,
						})
					} else if (op.type === "update") {
						const before = await Bun.file(filePath).text()
						let after: string
						try {
							after = applyHunks(before, op.hunks)
						} catch (e) {
							return {
								output: `Failed to apply hunks to ${op.path}: ${e instanceof Error ? e.message : String(e)}`,
							}
						}

						if (op.moveTo) {
							const newPath = resolvePath(op.moveTo)
							await mkdir(dirname(newPath), { recursive: true })
							await Bun.write(newPath, after)
							await rm(filePath)
							bus().emit("file:changed", {
								path: relative(Workspace.dir(), newPath),
								event: "add",
							})
							bus().emit("file:changed", {
								path: relative(Workspace.dir(), filePath),
								event: "unlink",
							})
						} else {
							await Bun.write(filePath, after)
							bus().emit("file:changed", {
								path: relative(Workspace.dir(), filePath),
								event: "change",
							})
						}

						const displayPath = op.moveTo ? `${op.path} -> ${op.moveTo}` : op.path
						const { diff, additions, deletions } = computeDiff(displayPath, before, after)
						totalAdditions += additions
						totalDeletions += deletions
						fileResults.push({
							path: displayPath,
							type: op.moveTo ? "move" : "update",
							diff: trimDiff(diff),
							before,
							after,
							additions,
							deletions,
						})
					}
				}

				ctx.metadata({
					metadata: {
						files: fileResults,
						totalAdditions,
						totalDeletions,
						type: "patch",
					},
				})

				const summary = fileResults
					.map((f) => `  ${f.type}: ${f.path} (+${f.additions}/-${f.deletions})`)
					.join("\n")

				return {
					output: `Applied patch to ${ops.length} file(s):\n${summary}`,
					metadata: {
						files: fileResults,
						totalAdditions,
						totalDeletions,
					},
				}
			},
		}
	},
}

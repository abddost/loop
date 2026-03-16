import { readdir, stat } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, resolve } from "node:path"
import { z } from "zod"
import { Workspace } from "../../workspace"
import { Tool } from "../shape"

const MAX_LINE_LENGTH = 2000
const MAX_OUTPUT_BYTES = 50 * 1024
const DEFAULT_LIMIT = 2000

const BINARY_EXTENSIONS = new Set([
	".zip",
	".gz",
	".tar",
	".bz2",
	".7z",
	".rar",
	".exe",
	".dll",
	".so",
	".dylib",
	".bin",
	".obj",
	".o",
	".a",
	".lib",
	".wasm",
	".class",
	".jar",
	".pyc",
	".pyd",
	".pyo",
	".ico",
	".icns",
	".ttf",
	".otf",
	".woff",
	".woff2",
	".eot",
	".mp3",
	".mp4",
	".avi",
	".mov",
	".wmv",
	".flv",
	".mkv",
	".webm",
	".wav",
	".flac",
	".aac",
	".ogg",
	".sqlite",
	".db",
	".mdb",
])

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"])
const PDF_EXTENSIONS = new Set([".pdf"])

function isBinaryByExtension(filePath: string): boolean {
	return BINARY_EXTENSIONS.has(extname(filePath).toLowerCase())
}

function isBinaryByContent(buffer: Uint8Array): boolean {
	if (buffer.length === 0) return false
	const sample = Math.min(buffer.length, 8192)
	let nonPrintable = 0
	for (let i = 0; i < sample; i++) {
		const byte = buffer[i]
		// Allow tab, newline, carriage return; flag other control chars
		if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
			nonPrintable++
		}
	}
	return nonPrintable / sample > 0.3
}

function isImageFile(filePath: string): boolean {
	return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())
}

function isPdfFile(filePath: string): boolean {
	return PDF_EXTENSIONS.has(extname(filePath).toLowerCase())
}

function truncateLine(line: string): string {
	if (line.length <= MAX_LINE_LENGTH) return line
	return `${line.slice(0, MAX_LINE_LENGTH)}...`
}

async function findSimilarFiles(dirPath: string, targetName: string): Promise<string[]> {
	try {
		const entries = await readdir(dirPath)
		const target = targetName.toLowerCase()
		return entries
			.filter((entry) => {
				const lower = entry.toLowerCase()
				return lower.includes(target) || target.includes(lower) || levenshteinClose(lower, target)
			})
			.slice(0, 5)
	} catch {
		return []
	}
}

function levenshteinClose(a: string, b: string): boolean {
	if (Math.abs(a.length - b.length) > 3) return false
	let dist = 0
	const len = Math.min(a.length, b.length)
	for (let i = 0; i < len; i++) {
		if (a[i] !== b[i]) dist++
	}
	dist += Math.abs(a.length - b.length)
	return dist <= 2
}

/** Read a file or directory from the workspace. Safe tool -- no permission required. */
export const readTool: Tool.Shape = Tool.define("read", () => ({
	description: [
		"Reads a file from the workspace and returns its content with line numbers.",
		"Can also list directory contents when given a directory path.",
		"Supports offset and limit for reading portions of large files.",
		"For images and PDFs, returns base64-encoded data.",
	].join(" "),
	parameters: z.object({
		path: z.string().describe("Path to the file or directory (absolute or relative to workspace)"),
		offset: z
			.number()
			.int()
			.optional()
			.describe("Line number to start reading from (1-based, must be >= 1)"),
		limit: z
			.number()
			.int()
			.positive()
			.optional()
			.describe(`Maximum number of lines to read (default: ${DEFAULT_LIMIT})`),
	}),
	async execute(ctx, input) {
		await ctx.ask({
			permission: "read",
			patterns: [input.path],
			always: ["*"],
		})

		const filePath = isAbsolute(input.path) ? input.path : resolve(Workspace.dir(), input.path)

		// Validate offset
		if (input.offset !== undefined && input.offset < 1) {
			return {
				output: `Invalid offset: ${input.offset}. Offset must be >= 1 (1-indexed).`,
			}
		}

		// Check if path exists
		let fileStat: Awaited<ReturnType<typeof stat>>
		try {
			fileStat = await stat(filePath)
		} catch {
			// File not found — search for similar names
			const dir = dirname(filePath)
			const name = basename(filePath)
			const suggestions = await findSimilarFiles(dir, name)
			let output = `File not found: ${input.path}`
			if (suggestions.length > 0) {
				output += `\n\nDid you mean one of these?\n${suggestions.map((s) => `  ${s}`).join("\n")}`
			}
			return { output }
		}

		// Handle directories
		if (fileStat.isDirectory()) {
			const entries = await readdir(filePath)
			const annotated: string[] = []
			for (const entry of entries.sort()) {
				try {
					const s = await stat(resolve(filePath, entry))
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
				metadata: { type: "directory", count: annotated.length },
			}
		}

		// Handle images — return base64 data URL
		if (isImageFile(filePath)) {
			const file = Bun.file(filePath)
			const buffer = await file.arrayBuffer()
			const base64 = Buffer.from(buffer).toString("base64")
			const ext = extname(filePath).toLowerCase().slice(1)
			const mimeType = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`
			return {
				output: `[Image file: ${basename(filePath)} (${fileStat.size} bytes)]`,
				metadata: {
					type: "image",
					dataUrl: `data:${mimeType};base64,${base64}`,
					size: fileStat.size,
				},
			}
		}

		// Handle PDFs — return base64 data URL
		if (isPdfFile(filePath)) {
			const file = Bun.file(filePath)
			const buffer = await file.arrayBuffer()
			const base64 = Buffer.from(buffer).toString("base64")
			return {
				output: `[PDF file: ${basename(filePath)} (${fileStat.size} bytes)]`,
				metadata: {
					type: "pdf",
					dataUrl: `data:application/pdf;base64,${base64}`,
					size: fileStat.size,
				},
			}
		}

		// Check binary by extension
		if (isBinaryByExtension(filePath)) {
			return {
				output: `Binary file: ${input.path} (${fileStat.size} bytes). Cannot display binary content.`,
				metadata: { type: "binary", size: fileStat.size },
			}
		}

		// Read file content
		const file = Bun.file(filePath)
		const rawBytes = new Uint8Array(await file.arrayBuffer())

		// Check binary by content inspection
		if (isBinaryByContent(rawBytes)) {
			return {
				output: `Binary file: ${input.path} (${fileStat.size} bytes). Cannot display binary content.`,
				metadata: { type: "binary", size: fileStat.size },
			}
		}

		const text = new TextDecoder().decode(rawBytes)
		const allLines = text.split("\n")
		const totalLines = allLines.length

		const offset = Math.max(0, (input.offset ?? 1) - 1)
		const limit = input.limit ?? DEFAULT_LIMIT

		// Validate offset range
		if (offset >= totalLines && totalLines > 0) {
			return {
				output: `Offset ${input.offset} is beyond end of file (${totalLines} lines). Use an offset between 1 and ${totalLines}.`,
				metadata: { totalLines },
			}
		}

		const slice = allLines.slice(offset, offset + limit)

		// Build output with line numbers, truncating long lines
		const encoder = new TextEncoder()
		const outputLines: string[] = []
		let outputBytes = 0

		for (let i = 0; i < slice.length; i++) {
			const lineNum = offset + i + 1
			const line = truncateLine(slice[i])
			const formatted = `${lineNum}: ${line}`
			const lineBytes = encoder.encode(`${formatted}\n`).byteLength
			if (outputBytes + lineBytes > MAX_OUTPUT_BYTES && outputLines.length > 0) {
				outputLines.push("...[output truncated due to size]")
				break
			}
			outputLines.push(formatted)
			outputBytes += lineBytes
		}

		const hasMore = offset + limit < totalLines

		ctx.metadata({
			metadata: {
				readTime: Date.now(),
				path: filePath,
			},
		})

		return {
			output: outputLines.join("\n"),
			metadata: {
				type: "file",
				totalLines,
				linesShown: Math.min(slice.length, outputLines.length),
				offset: offset + 1,
				hasMore,
				readTime: Date.now(),
			},
		}
	},
}))

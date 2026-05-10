import { readFile, readdir, stat } from "node:fs/promises"
import { extname, isAbsolute, resolve } from "node:path"
import type { MessageWithParts } from "@core/schema/message"
import type { FilePart, Part } from "@core/schema/part"
import { createLogger } from "../logger"
import { Workspace } from "../workspace"

const log = createLogger("enrich-files")

const MAX_DIR_ENTRIES = 2000

/** Maximum file size we'll inline into a prompt. Above this we emit a
 *  marker text block so the model knows the file was attached without
 *  blowing up token budgets / DB rows. */
const MAX_INLINE_FILE_BYTES = 5 * 1024 * 1024

/**
 * Enrich file parts in user messages with server-side content.
 *
 * Currently handles directory attachments: reads the directory listing
 * from disk and injects it as formatted text content so the model
 * can see the directory structure without needing a tool call.
 *
 * Operates on in-memory copies — does NOT mutate or persist changes.
 */
export async function enrichFileParts(messages: MessageWithParts[]): Promise<MessageWithParts[]> {
	const result: MessageWithParts[] = []

	for (const msg of messages) {
		if (msg.role !== "user" || !hasDirectoryParts(msg.parts)) {
			result.push(msg)
			continue
		}

		const enrichedParts: Part[] = []
		for (const part of msg.parts) {
			if (part.type === "file" && part.mimeType === "application/x-directory" && !part.content) {
				enrichedParts.push(await enrichDirectoryPart(part))
			} else {
				enrichedParts.push(part)
			}
		}

		result.push({ ...msg, parts: enrichedParts })
	}

	return result
}

function hasDirectoryParts(parts: Part[]): boolean {
	return parts.some(
		(p) => p.type === "file" && p.mimeType === "application/x-directory" && !p.content,
	)
}

/**
 * Read each path-only file attachment from disk and populate its
 * `content` + `mimeType` so downstream runtimes (Claude Code, Cursor,
 * OpenCode, AI-SDK) all see the same self-contained `FilePart`.
 *
 * Called at submission time from `promptSession` BEFORE the user message
 * is persisted, so the DB stores the resolved bytes and history reloads
 * see the same content. Mirrors t3code's pattern of reading attachments
 * server-side at turn dispatch.
 *
 * Mutates `files` in place (no allocation if there's nothing to enrich)
 * and returns it for chaining.
 */
export async function enrichSubmissionFiles(
	files: Array<{ path: string; mimeType: string; content: string }> | undefined,
): Promise<Array<{ path: string; mimeType: string; content: string }> | undefined> {
	if (!files || files.length === 0) return files
	for (const file of files) {
		if (file.content) continue

		if (file.mimeType === "application/x-directory") {
			file.content = await readDirectoryListing(file.path)
			continue
		}

		const resolved = await resolvePathFile(file.path)
		file.mimeType = resolved.mimeType
		file.content = resolved.content
	}
	return files
}

interface ResolvedPathFile {
	mimeType: string
	content: string
}

/** Read a file from disk under the workspace and produce the right
 *  `FilePart` shape for it: base64 data URL for images/PDFs/binary,
 *  plain text for text-y files, marker text on error. Never throws. */
async function resolvePathFile(path: string): Promise<ResolvedPathFile> {
	const absPath = isAbsolute(path) ? path : resolve(Workspace.dir(), path)
	let stats: Awaited<ReturnType<typeof stat>>
	try {
		stats = await stat(absPath)
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		log.warn("Failed to stat dragged file", { path, error: msg })
		return {
			mimeType: "text/plain",
			content: `[Attached file unavailable: ${path} — ${msg}]`,
		}
	}

	if (stats.isDirectory()) {
		// Caller should have routed this to enrichDirectoryPart; keep the
		// fallback safe so we don't try to readFile() a directory.
		return { mimeType: "application/x-directory", content: "" }
	}

	if (stats.size > MAX_INLINE_FILE_BYTES) {
		const mb = (stats.size / (1024 * 1024)).toFixed(1)
		return {
			mimeType: "text/plain",
			content: `[Attached file too large to inline: ${path} (${mb} MB > 5 MB limit). Reference it by path and use a Read tool instead.]`,
		}
	}

	const mimeType = guessMimeType(absPath)
	try {
		if (isTextMime(mimeType)) {
			const text = await readFile(absPath, "utf8")
			return { mimeType, content: text }
		}
		const buf = await readFile(absPath)
		return {
			mimeType,
			content: `data:${mimeType};base64,${buf.toString("base64")}`,
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		log.warn("Failed to read dragged file", { path, error: msg })
		return {
			mimeType: "text/plain",
			content: `[Attached file unreadable: ${path} — ${msg}]`,
		}
	}
}

const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml", "application/yaml"]
const TEXT_MIME_SUFFIXES = ["+json", "+xml", "+yaml"]

function isTextMime(mime: string): boolean {
	if (TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true
	if (TEXT_MIME_SUFFIXES.some((s) => mime.endsWith(s))) return true
	return false
}

const MIME_BY_EXT: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".pdf": "application/pdf",
	".json": "application/json",
	".md": "text/markdown",
	".markdown": "text/markdown",
	".txt": "text/plain",
	".log": "text/plain",
	".csv": "text/csv",
	".tsv": "text/tab-separated-values",
	".yml": "text/yaml",
	".yaml": "text/yaml",
	".toml": "text/plain",
	".xml": "application/xml",
	".html": "text/html",
	".htm": "text/html",
	".css": "text/css",
	".scss": "text/css",
	".js": "text/javascript",
	".jsx": "text/javascript",
	".mjs": "text/javascript",
	".cjs": "text/javascript",
	".ts": "text/typescript",
	".tsx": "text/typescript",
	".py": "text/x-python",
	".rb": "text/x-ruby",
	".rs": "text/x-rust",
	".go": "text/x-go",
	".java": "text/x-java",
	".c": "text/x-c",
	".h": "text/x-c",
	".cpp": "text/x-c++",
	".cc": "text/x-c++",
	".hpp": "text/x-c++",
	".cs": "text/x-csharp",
	".swift": "text/x-swift",
	".kt": "text/x-kotlin",
	".sh": "text/x-shellscript",
	".bash": "text/x-shellscript",
	".zsh": "text/x-shellscript",
	".fish": "text/x-shellscript",
	".sql": "text/x-sql",
	".env": "text/plain",
	".gitignore": "text/plain",
	".dockerignore": "text/plain",
}

/** Cheap mime-type guess from filename. Defaults to `application/octet-stream`
 *  for unknown extensions; the resolver falls back to base64 for those. */
function guessMimeType(filePath: string): string {
	const ext = extname(filePath).toLowerCase()
	return MIME_BY_EXT[ext] ?? "application/octet-stream"
}

async function enrichDirectoryPart(part: FilePart): Promise<FilePart> {
	return { ...part, content: await readDirectoryListing(part.path) }
}

/** Read a directory listing as a formatted text block. Handles relative
 *  paths via the current Workspace, caps entries, gracefully reports
 *  errors. Shared between submission-time and runtime-time enrichment. */
async function readDirectoryListing(path: string): Promise<string> {
	const dirPath = isAbsolute(path) ? path : resolve(Workspace.dir(), path)
	try {
		const entries = await readdir(dirPath)
		const annotated: string[] = []
		for (const entry of entries.sort()) {
			if (annotated.length >= MAX_DIR_ENTRIES) {
				annotated.push(`...[${entries.length - MAX_DIR_ENTRIES} more entries not shown]`)
				break
			}
			try {
				const s = await stat(resolve(dirPath, entry))
				annotated.push(s.isDirectory() ? `${entry}/` : entry)
			} catch {
				annotated.push(entry)
			}
		}
		const listing = annotated.length > 0 ? annotated.join("\n") : "(empty directory)"
		return `--- Directory: ${path} ---\n${listing}\n--- End of directory listing ---`
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		log.error("Failed to read directory for attachment", { path, error: msg })
		return `ERROR: Failed to read directory "${path}": ${msg}. Ask the user to verify the path exists.`
	}
}

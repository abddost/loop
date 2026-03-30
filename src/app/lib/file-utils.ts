export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const

const IMAGE_MIMES = new Set<string>(ACCEPTED_IMAGE_TYPES)

const IMAGE_EXTS = new Map([
	["gif", "image/gif"],
	["jpeg", "image/jpeg"],
	["jpg", "image/jpeg"],
	["png", "image/png"],
	["webp", "image/webp"],
])

const TEXT_MIMES = new Set([
	"application/json",
	"application/ld+json",
	"application/toml",
	"application/x-toml",
	"application/x-yaml",
	"application/xml",
	"application/yaml",
])

export const ACCEPTED_FILE_TYPES = [
	...ACCEPTED_IMAGE_TYPES,
	"application/pdf",
	"text/*",
	"application/json",
	"application/ld+json",
	"application/toml",
	"application/x-toml",
	"application/x-yaml",
	"application/xml",
	"application/yaml",
	".c",
	".cc",
	".cjs",
	".conf",
	".cpp",
	".css",
	".csv",
	".cts",
	".env",
	".go",
	".gql",
	".graphql",
	".h",
	".hh",
	".hpp",
	".htm",
	".html",
	".ini",
	".java",
	".js",
	".json",
	".jsx",
	".log",
	".md",
	".mdx",
	".mjs",
	".mts",
	".pdf",
	".py",
	".rb",
	".rs",
	".sass",
	".scss",
	".sh",
	".sql",
	".swift",
	".toml",
	".ts",
	".tsx",
	".txt",
	".xml",
	".yaml",
	".yml",
	".zsh",
]

/** 10 MB per individual file (base64 inflates ~33%). */
export const MAX_FILE_SIZE = 10 * 1024 * 1024
/** 25 MB aggregate across all pending attachments. */
export const MAX_TOTAL_SIZE = 25 * 1024 * 1024

const BINARY_SAMPLE_SIZE = 4096

function stripParams(type: string): string {
	return type.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

function fileExt(name: string): string {
	const idx = name.lastIndexOf(".")
	if (idx === -1) return ""
	return name.slice(idx + 1).toLowerCase()
}

function isTextMime(type: string): boolean {
	if (!type) return false
	if (type.startsWith("text/")) return true
	if (TEXT_MIMES.has(type)) return true
	if (type.endsWith("+json")) return true
	return type.endsWith("+xml")
}

/**
 * Heuristic: reject if any null byte is present; otherwise allow up to 30%
 * non-printable control characters (handles UTF-8 with BOM, etc.).
 */
function isTextContent(bytes: Uint8Array): boolean {
	if (bytes.length === 0) return true
	let suspicious = 0
	for (const byte of bytes) {
		if (byte === 0) return false
		if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1
	}
	return suspicious / bytes.length <= 0.3
}

/**
 * Detect the effective MIME type for an attachment.
 *
 * Pipeline:
 *  1. Trust the browser MIME for known image/PDF types.
 *  2. If browser MIME is missing or generic, fall back to extension mapping.
 *  3. If the MIME is a known text-family type, normalise to `text/plain`.
 *  4. Otherwise sample the first 4 KB and run a binary sniff.
 *
 * Returns `null` for unsupported / binary files.
 */
export async function detectMime(file: File): Promise<string | null> {
	const type = stripParams(file.type)
	if (IMAGE_MIMES.has(type)) return type
	if (type === "application/pdf") return type

	const suffix = fileExt(file.name)
	const fallback = IMAGE_EXTS.get(suffix) ?? (suffix === "pdf" ? "application/pdf" : undefined)
	if ((!type || type === "application/octet-stream") && fallback) return fallback

	if (isTextMime(type)) return "text/plain"

	const bytes = new Uint8Array(await file.slice(0, BINARY_SAMPLE_SIZE).arrayBuffer())
	if (!isTextContent(bytes)) return null
	return "text/plain"
}

export function isImageMime(mime: string): boolean {
	return IMAGE_MIMES.has(mime)
}

export function validateFileSize(file: File): { ok: boolean; error?: string } {
	if (file.size > MAX_FILE_SIZE) {
		const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
		return { ok: false, error: `${file.name} is too large (${sizeMB} MB). Maximum is 10 MB.` }
	}
	return { ok: true }
}

export function validateTotalSize(
	existingBytes: number,
	incomingBytes: number,
): { ok: boolean; error?: string } {
	if (existingBytes + incomingBytes > MAX_TOTAL_SIZE) {
		return { ok: false, error: "Total attachment size exceeds 25 MB limit." }
	}
	return { ok: true }
}

/**
 * Read a File as a data URL, normalising the MIME in the prefix.
 * Resolves to an empty string on read failure so callers can skip gracefully.
 */
export function readFileAsDataUrl(file: File, mime: string): Promise<string> {
	return new Promise<string>((resolve) => {
		const reader = new FileReader()
		reader.addEventListener("error", () => resolve(""))
		reader.addEventListener("load", () => {
			const raw = typeof reader.result === "string" ? reader.result : ""
			const commaIdx = raw.indexOf(",")
			if (commaIdx === -1) {
				resolve(raw)
				return
			}
			resolve(`data:${mime};base64,${raw.slice(commaIdx + 1)}`)
		})
		reader.readAsDataURL(file)
	})
}

export interface DroppedFolder {
	name: string
	fullPath: string
}

export interface DropResult {
	files: File[]
	folders: DroppedFolder[]
}

/**
 * Classify dropped items into individual files and folder references.
 * Folders are NOT recursed into -- the caller receives the directory name/path
 * so it can be sent as a single path-only attachment.
 */
export async function classifyDroppedItems(dataTransfer: DataTransfer): Promise<DropResult> {
	const items = Array.from(dataTransfer.items)
	const hasEntryApi = items.length > 0 && typeof items[0].webkitGetAsEntry === "function"

	if (!hasEntryApi) {
		return { files: Array.from(dataTransfer.files), folders: [] }
	}

	const files: File[] = []
	const folders: DroppedFolder[] = []

	for (const item of items) {
		const entry = item.webkitGetAsEntry()
		if (!entry) continue

		if (entry.isDirectory) {
			folders.push({ name: entry.name, fullPath: entry.fullPath })
		} else if (entry.isFile) {
			const file = await new Promise<File | null>((resolve) => {
				;(entry as FileSystemFileEntry).file(
					(f) => resolve(f),
					() => resolve(null),
				)
			})
			if (file) files.push(file)
		}
	}

	return { files, folders }
}

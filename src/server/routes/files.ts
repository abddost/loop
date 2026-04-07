import { readdir } from "node:fs/promises"
import { extname, relative, resolve } from "node:path"
import { Hono } from "hono"
import { Workspace } from "../workspace"
import { requireWorkspace } from "./require-workspace"

export const fileRoutes = new Hono()

// ── Binary detection ─────────────────────────────────

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
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".svg",
	".pdf",
])

// ── Language detection ────────────────────────────────

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
	".ts": "typescript",
	".tsx": "typescript",
	".js": "javascript",
	".jsx": "javascript",
	".py": "python",
	".rs": "rust",
	".go": "go",
	".java": "java",
	".c": "c",
	".h": "c",
	".cpp": "cpp",
	".hpp": "cpp",
	".css": "css",
	".html": "html",
	".json": "json",
	".md": "markdown",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".sql": "sql",
	".sh": "shell",
	".bash": "shell",
	".rb": "ruby",
	".swift": "swift",
	".kt": "kotlin",
	".xml": "xml",
	".graphql": "graphql",
}

// ── Helpers ───────────────────────────────────────────

/** Resolve a relative path within the workspace and guard against traversal. */
function resolveAndValidate(workspaceDir: string, relativePath: string): string {
	const resolved = resolve(workspaceDir, relativePath)
	if (!resolved.startsWith(`${workspaceDir}/`) && resolved !== workspaceDir) {
		throw new Error("Path traversal detected")
	}
	return resolved
}

// ── GET /files/tree ──────────────────────────────────

fileRoutes.get("/files/tree", async (c) => {
	requireWorkspace()
	const workspaceDir = Workspace.dir()
	const pathParam = c.req.query("path") ?? "."

	const resolved = resolveAndValidate(workspaceDir, pathParam)

	const entries = await readdir(resolved, { withFileTypes: true })

	const result = entries
		.filter((entry) => entry.name !== ".git")
		.map((entry) => ({
			name: entry.name,
			path: relative(workspaceDir, resolve(resolved, entry.name)),
			type: (entry.isDirectory() ? "directory" : "file") as "file" | "directory",
		}))
		.sort((a, b) => {
			if (a.type !== b.type) return a.type === "directory" ? -1 : 1
			return a.name.localeCompare(b.name)
		})

	return c.json(result)
})

// ── GET /files/read ──────────────────────────────────

fileRoutes.get("/files/read", async (c) => {
	requireWorkspace()
	const workspaceDir = Workspace.dir()

	const pathParam = c.req.query("path")
	if (!pathParam) {
		return c.json({ error: "path query parameter is required" }, 400)
	}

	const offset = Number(c.req.query("offset") ?? "0")
	const limit = Number(c.req.query("limit") ?? "5000")

	const resolved = resolveAndValidate(workspaceDir, pathParam)
	const ext = extname(resolved).toLowerCase()

	// Binary check by extension
	if (BINARY_EXTENSIONS.has(ext)) {
		return c.json({ content: "", totalLines: 0, language: "", binary: true })
	}

	const text = await Bun.file(resolved).text()
	const allLines = text.split("\n")
	const totalLines = allLines.length

	const slice = allLines.slice(offset, offset + limit)
	const content = slice.join("\n")
	const language = EXTENSION_TO_LANGUAGE[ext] ?? ""

	return c.json({ content, totalLines, language, binary: false })
})

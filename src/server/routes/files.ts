import { readdir } from "node:fs/promises"
import { extname, join, relative } from "node:path"
import { Hono } from "hono"
import { PathEscapeError, resolveInWorkspace } from "../lib/filesystem"
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

/**
 * Resolve a path within the workspace using realpath canonicalization.
 * Returns a JSON error response on escape instead of throwing, so route
 * handlers can short-circuit cleanly.
 */
function safeResolve(
	workspaceDir: string,
	inputPath: string,
): { ok: true; path: string } | { ok: false; error: string } {
	try {
		return { ok: true, path: resolveInWorkspace(workspaceDir, inputPath) }
	} catch (err) {
		if (err instanceof PathEscapeError) return { ok: false, error: err.message }
		throw err
	}
}

// ── GET /files/tree ──────────────────────────────────

fileRoutes.get("/files/tree", async (c) => {
	requireWorkspace()
	const workspaceDir = Workspace.dir()
	const pathParam = c.req.query("path") ?? "."

	const res = safeResolve(workspaceDir, pathParam)
	if (!res.ok) return c.json({ error: res.error }, 400)

	const entries = await readdir(res.path, { withFileTypes: true })

	const result = entries
		.filter((entry) => entry.name !== ".git")
		.map((entry) => ({
			name: entry.name,
			path: relative(workspaceDir, join(res.path, entry.name)),
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

	const res = safeResolve(workspaceDir, pathParam)
	if (!res.ok) return c.json({ error: res.error }, 400)
	const resolved = res.path
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

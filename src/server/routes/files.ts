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

// ── GET /files/list ──────────────────────────────────
//
// Recursive file list for Quick Open. Prefers `git ls-files` so .gitignore
// is honored automatically; falls back to a bounded recursive readdir for
// non-git workspaces.

const MAX_FILE_LIST = 10_000
const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".next",
	".turbo",
	".cache",
	"coverage",
	"out",
	".venv",
	"venv",
	"__pycache__",
	"target",
	".idea",
	".vscode-test",
])

async function listViaGit(workspaceDir: string): Promise<string[] | null> {
	const proc = Bun.spawn(["git", "ls-files", "--cached", "--others", "--exclude-standard"], {
		cwd: workspaceDir,
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	})
	const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
	if (exitCode !== 0) return null
	return stdout
		.split("\n")
		.filter((line) => line.length > 0)
		.slice(0, MAX_FILE_LIST)
}

async function listViaWalk(workspaceDir: string): Promise<string[]> {
	const out: string[] = []
	const stack: string[] = ["."]
	while (stack.length > 0 && out.length < MAX_FILE_LIST) {
		const dirPath = stack.pop()!
		const abs = dirPath === "." ? workspaceDir : join(workspaceDir, dirPath)
		let entries: import("node:fs").Dirent[]
		try {
			entries = await readdir(abs, { withFileTypes: true })
		} catch {
			continue
		}
		for (const entry of entries) {
			if (out.length >= MAX_FILE_LIST) break
			if (SKIP_DIRS.has(entry.name)) continue
			const rel = dirPath === "." ? entry.name : `${dirPath}/${entry.name}`
			if (entry.isDirectory()) {
				stack.push(rel)
			} else if (entry.isFile()) {
				out.push(rel)
			}
		}
	}
	return out
}

fileRoutes.get("/files/list", async (c) => {
	requireWorkspace()
	const workspaceDir = Workspace.dir()
	const files = (await listViaGit(workspaceDir)) ?? (await listViaWalk(workspaceDir))
	return c.json({ files, truncated: files.length >= MAX_FILE_LIST })
})

// ── POST /files/write ────────────────────────────────
//
// Atomic file write with workspace-relative path validation. Refuses
// binary extensions and any path that escapes the workspace root.

fileRoutes.post("/files/write", async (c) => {
	requireWorkspace()
	const workspaceDir = Workspace.dir()

	let body: { path?: string; content?: string }
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: "invalid JSON body" }, 400)
	}

	const { path: pathParam, content } = body
	if (!pathParam || typeof pathParam !== "string") {
		return c.json({ error: "path is required" }, 400)
	}
	if (typeof content !== "string") {
		return c.json({ error: "content must be a string" }, 400)
	}

	const res = safeResolve(workspaceDir, pathParam)
	if (!res.ok) return c.json({ error: res.error }, 400)
	const resolved = res.path
	const ext = extname(resolved).toLowerCase()
	if (BINARY_EXTENSIONS.has(ext)) {
		return c.json({ error: "cannot write to binary file types" }, 400)
	}

	try {
		await Bun.write(resolved, content)
		return c.json({ ok: true })
	} catch (err) {
		const message = err instanceof Error ? err.message : "write failed"
		return c.json({ error: message }, 500)
	}
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

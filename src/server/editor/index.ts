import { execSync, spawn } from "node:child_process"
import { isAbsolute, resolve } from "node:path"
import type { EditorInfo } from "@core/schema/editor"
import { createLogger } from "../logger"

const log = createLogger("editor")

// ────────────────────────────────────────────────────────────
// Editor definitions
// ────────────────────────────────────────────────────────────

interface EditorDef {
	id: string
	name: string
	/** CLI command used to check availability and launch. */
	command: string
	/** Build argv for opening a file (optionally at a line). */
	fileArgs(path: string, line?: number): string[]
	/** Build argv for opening a directory. */
	dirArgs(path: string): string[]
}

const EDITORS: EditorDef[] = [
	{
		id: "vscode",
		name: "VS Code",
		command: "code",
		fileArgs: (p, l) => (l ? ["--goto", `${p}:${l}`] : [p]),
		dirArgs: (p) => [p],
	},
	{
		id: "cursor",
		name: "Cursor",
		command: "cursor",
		fileArgs: (p, l) => (l ? ["--goto", `${p}:${l}`] : [p]),
		dirArgs: (p) => [p],
	},
	{
		id: "windsurf",
		name: "Windsurf",
		command: "windsurf",
		fileArgs: (p, l) => (l ? ["--goto", `${p}:${l}`] : [p]),
		dirArgs: (p) => [p],
	},
	{
		id: "zed",
		name: "Zed",
		command: "zed",
		fileArgs: (p, l) => (l ? [`${p}:${l}`] : [p]),
		dirArgs: (p) => [p],
	},
	{
		id: "sublime",
		name: "Sublime Text",
		command: "subl",
		fileArgs: (p, l) => (l ? [`${p}:${l}`] : [p]),
		dirArgs: (p) => [p],
	},
	{
		id: "idea",
		name: "IntelliJ IDEA",
		command: "idea",
		fileArgs: (p, l) => (l ? ["--line", String(l), p] : [p]),
		dirArgs: (p) => [p],
	},
	{
		id: "webstorm",
		name: "WebStorm",
		command: "webstorm",
		fileArgs: (p, l) => (l ? ["--line", String(l), p] : [p]),
		dirArgs: (p) => [p],
	},
	{
		id: "xcode",
		name: "Xcode",
		command: "xed",
		fileArgs: (p, l) => (l ? ["--line", String(l), p] : [p]),
		dirArgs: (p) => [p],
	},
	{
		id: "android-studio",
		name: "Android Studio",
		command: "studio",
		fileArgs: (p, l) => (l ? ["--line", String(l), p] : [p]),
		dirArgs: (p) => [p],
	},
	{
		id: "neovim",
		name: "Neovim",
		command: "nvim",
		fileArgs: (p, l) => (l ? [`+${l}`, p] : [p]),
		dirArgs: (p) => [p],
	},
]

/** Finder is always available on macOS and treated specially. */
const FINDER: EditorDef = {
	id: "finder",
	name: "Finder",
	command: "open",
	fileArgs: (p) => ["-R", p],
	dirArgs: (p) => [p],
}

// ────────────────────────────────────────────────────────────
// Detection (cached)
// ────────────────────────────────────────────────────────────

let cached: EditorInfo[] | null = null

function isCommandAvailable(command: string): boolean {
	try {
		execSync(`which ${command}`, { stdio: "ignore" })
		return true
	} catch {
		return false
	}
}

/** Detect which editors are installed. Cached after first call. */
export function detectEditors(): EditorInfo[] {
	if (cached) return cached

	const results: EditorInfo[] = [{ id: FINDER.id, name: FINDER.name, available: true }]

	for (const editor of EDITORS) {
		results.push({
			id: editor.id,
			name: editor.name,
			available: isCommandAvailable(editor.command),
		})
	}

	cached = results
	log.info("Detected editors", {
		available: results.filter((e) => e.available).map((e) => e.id),
	})
	return results
}

/** Force re-detection on next call. */
export function invalidateCache(): void {
	cached = null
}

// ────────────────────────────────────────────────────────────
// Open
// ────────────────────────────────────────────────────────────

function findEditor(editorId: string): EditorDef | undefined {
	if (editorId === FINDER.id) return FINDER
	return EDITORS.find((e) => e.id === editorId)
}

/**
 * Open a file in the specified editor.
 * Relative paths are resolved against `cwd`.
 */
export function openFile(editorId: string, filePath: string, cwd: string, line?: number): void {
	const editor = findEditor(editorId)
	if (!editor) throw new Error(`Unknown editor: ${editorId}`)

	const absPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
	const args = editor.fileArgs(absPath, line)

	log.info("Opening file", { editor: editorId, path: absPath, line })
	spawn(editor.command, args, { detached: true, stdio: "ignore", cwd }).unref()
}

/** Open a directory in the specified editor. */
export function openDirectory(editorId: string, dirPath: string): void {
	const editor = findEditor(editorId)
	if (!editor) throw new Error(`Unknown editor: ${editorId}`)

	const args = editor.dirArgs(dirPath)

	log.info("Opening directory", { editor: editorId, path: dirPath })
	spawn(editor.command, args, { detached: true, stdio: "ignore" }).unref()
}

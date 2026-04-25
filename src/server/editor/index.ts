import { execSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
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
	/** macOS .app bundle name. If present, detection succeeds and `open -a` is used as a fallback launcher. */
	app?: string
	/** CLI command. Preferred launcher when in PATH (supports line jumps). */
	cli?: string
	/** Build argv for the CLI when opening a file. */
	cliFileArgs?(path: string, line?: number): string[]
	/** Build argv for the CLI when opening a directory. */
	cliDirArgs?(path: string): string[]
}

const EDITORS: EditorDef[] = [
	{
		id: "vscode",
		name: "VS Code",
		app: "Visual Studio Code",
		cli: "code",
		cliFileArgs: (p, l) => (l ? ["--goto", `${p}:${l}`] : [p]),
		cliDirArgs: (p) => [p],
	},
	{
		id: "cursor",
		name: "Cursor",
		app: "Cursor",
		cli: "cursor",
		cliFileArgs: (p, l) => (l ? ["--goto", `${p}:${l}`] : [p]),
		cliDirArgs: (p) => [p],
	},
	{
		id: "windsurf",
		name: "Windsurf",
		app: "Windsurf",
		cli: "windsurf",
		cliFileArgs: (p, l) => (l ? ["--goto", `${p}:${l}`] : [p]),
		cliDirArgs: (p) => [p],
	},
	{
		id: "zed",
		name: "Zed",
		app: "Zed",
		cli: "zed",
		cliFileArgs: (p, l) => (l ? [`${p}:${l}`] : [p]),
		cliDirArgs: (p) => [p],
	},
	{
		id: "sublime",
		name: "Sublime Text",
		app: "Sublime Text",
		cli: "subl",
		cliFileArgs: (p, l) => (l ? [`${p}:${l}`] : [p]),
		cliDirArgs: (p) => [p],
	},
	{
		id: "xcode",
		name: "Xcode",
		app: "Xcode",
		cli: "xed",
		cliFileArgs: (p, l) => (l ? ["--line", String(l), p] : [p]),
		cliDirArgs: (p) => [p],
	},
	{
		id: "android-studio",
		name: "Android Studio",
		app: "Android Studio",
		cli: "studio",
		cliFileArgs: (p, l) => (l ? ["--line", String(l), p] : [p]),
		cliDirArgs: (p) => [p],
	},
	{
		id: "terminal",
		name: "Terminal",
		app: "Terminal",
	},
	{
		id: "ghostty",
		name: "Ghostty",
		app: "Ghostty",
	},
]

/** Finder is always available on macOS. */
const FINDER: EditorDef = {
	id: "finder",
	name: "Finder",
}

// ────────────────────────────────────────────────────────────
// Detection (always fresh — matches opencode's pattern)
// ────────────────────────────────────────────────────────────

const isMac = process.platform === "darwin"

function isCommandAvailable(command: string): boolean {
	try {
		execSync(`which ${command}`, { stdio: "ignore" })
		return true
	} catch {
		return false
	}
}

const MAC_APP_DIRS = [
	"/Applications",
	"/Applications/Utilities",
	"/System/Applications",
	"/System/Applications/Utilities",
	`${process.env.HOME}/Applications`,
]

function hasApp(appName: string): boolean {
	if (!isMac) return false
	return MAC_APP_DIRS.some((dir) => existsSync(`${dir}/${appName}.app`))
}

function isAvailable(editor: EditorDef): boolean {
	if (editor.cli && isCommandAvailable(editor.cli)) return true
	if (editor.app && hasApp(editor.app)) return true
	return false
}

/** Detect which editors are installed. Always runs fresh — cheap per-editor checks (<10ms total). */
export function detectEditors(): EditorInfo[] {
	const results: EditorInfo[] = [{ id: FINDER.id, name: FINDER.name, available: true }]

	for (const editor of EDITORS) {
		results.push({
			id: editor.id,
			name: editor.name,
			available: isAvailable(editor),
		})
	}

	log.info("Detected editors", {
		available: results.filter((e) => e.available).map((e) => e.id),
	})
	return results
}

// ────────────────────────────────────────────────────────────
// Open
// ────────────────────────────────────────────────────────────

function findEditor(editorId: string): EditorDef | undefined {
	if (editorId === FINDER.id) return FINDER
	return EDITORS.find((e) => e.id === editorId)
}

function openWithApp(appName: string, path: string, reveal = false): void {
	const args = reveal ? ["-R", path] : ["-a", appName, path]
	spawn("open", args, { detached: true, stdio: "ignore" }).unref()
}

/**
 * Open a file in the specified editor.
 * Relative paths are resolved against `cwd`.
 */
export function openFile(editorId: string, filePath: string, cwd: string, line?: number): void {
	const editor = findEditor(editorId)
	if (!editor) throw new Error(`Unknown editor: ${editorId}`)

	const absPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
	log.info("Opening file", { editor: editorId, path: absPath, line })

	// Finder reveals the file in its folder
	if (editor.id === FINDER.id) {
		openWithApp("Finder", absPath, true)
		return
	}

	// Prefer CLI when available (line-number support)
	if (editor.cli && editor.cliFileArgs && isCommandAvailable(editor.cli)) {
		spawn(editor.cli, editor.cliFileArgs(absPath, line), {
			detached: true,
			stdio: "ignore",
			cwd,
		}).unref()
		return
	}

	// Fallback: launch via .app bundle
	if (editor.app) {
		openWithApp(editor.app, absPath)
		return
	}

	throw new Error(`No launcher available for editor: ${editorId}`)
}

/** Open a directory in the specified editor. */
export function openDirectory(editorId: string, dirPath: string): void {
	const editor = findEditor(editorId)
	if (!editor) throw new Error(`Unknown editor: ${editorId}`)

	log.info("Opening directory", { editor: editorId, path: dirPath })

	if (editor.id === FINDER.id) {
		spawn("open", [dirPath], { detached: true, stdio: "ignore" }).unref()
		return
	}

	if (editor.cli && editor.cliDirArgs && isCommandAvailable(editor.cli)) {
		spawn(editor.cli, editor.cliDirArgs(dirPath), {
			detached: true,
			stdio: "ignore",
		}).unref()
		return
	}

	if (editor.app) {
		openWithApp(editor.app, dirPath)
		return
	}

	throw new Error(`No launcher available for editor: ${editorId}`)
}

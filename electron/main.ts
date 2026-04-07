/**
 * Electron main process entry point.
 *
 * Orchestrates the entire application lifecycle:
 *   1. Fix macOS PATH (before anything else)
 *   2. Initialize logging
 *   3. Register custom protocol scheme
 *   4. On app ready: configure menu, protocol handler, auto-updater
 *   5. Bootstrap: reserve port, generate token, start sidecar, create window
 *   6. Graceful shutdown on quit
 */

import * as crypto from "node:crypto"
import * as path from "node:path"
import { BrowserWindow, app, shell } from "electron"
import { fixPath } from "./fix-path"
import { registerIpcHandlers } from "./ipc"
import { RotatingFileSink, captureStdio, restoreStdio } from "./logging"
import { configureApplicationMenu } from "./menu"
import { closeAllPopouts } from "./popout"
import { reservePort } from "./port"
import { registerProtocolHandler, registerScheme } from "./protocol"
import { markQuitting, startSidecar, stopSidecar } from "./sidecar"
import {
	checkForUpdatesFromMenu,
	configureAutoUpdater,
	disposeAutoUpdater,
} from "./update"

// ── Constants ───────────────────────────────────────────────────────────────

const APP_NAME = "Loop"
const VITE_DEV_SERVER_URL =
	process.env.VITE_DEV_SERVER_URL || "http://localhost:1420"
const isDev = !app.isPackaged

// ── State ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let desktopLogSink: RotatingFileSink | null = null
let sidecarLogSink: RotatingFileSink | null = null
let isQuitting = false

// ── Synchronous Top-Level Setup ─────────────────────────────────────────────

// 1. Fix macOS PATH (must run before any child process spawning)
fixPath()

// 2. Initialize logging (packaged builds only)
if (app.isPackaged) {
	const logDir = getLogDir()
	desktopLogSink = new RotatingFileSink(path.join(logDir, "desktop-main.log"))
	sidecarLogSink = new RotatingFileSink(path.join(logDir, "server-child.log"))
	captureStdio(desktopLogSink)
}

// 3. Register custom protocol scheme (must be before app.whenReady)
registerScheme()

// ── App Ready ───────────────────────────────────────────────────────────────

app
	.whenReady()
	.then(async () => {
		// Configure app identity
		app.name = APP_NAME
		app.setAboutPanelOptions({
			applicationName: APP_NAME,
			applicationVersion: app.getVersion(),
		})

		// Build application menu
		configureApplicationMenu(
			() => mainWindow,
			app.isPackaged ? checkForUpdatesFromMenu : undefined,
		)

		// Register protocol handler (production only)
		if (!isDev) {
			registerProtocolHandler()
		}

		// Configure auto-updater
		configureAutoUpdater(() => mainWindow)

		// Bootstrap the app
		await bootstrap()
	})
	.catch((err) => {
		console.error("[main] Fatal startup error:", err)
		handleFatalError("bootstrap", err)
	})

// ── App Lifecycle ───────────────────────────────────────────────────────────

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit()
	}
})

app.on("activate", () => {
	// macOS: recreate window when dock icon is clicked
	if (BrowserWindow.getAllWindows().length === 0) {
		bootstrap().catch((err) => {
			console.error("[main] Failed to recreate window:", err)
		})
	}
})

app.on("before-quit", () => {
	isQuitting = true
	markQuitting()
	closeAllPopouts()
	disposeAutoUpdater()
	stopSidecar()
	if (app.isPackaged) {
		restoreStdio()
	}
})

// Non-Windows signal handlers
if (process.platform !== "win32") {
	const shutdown = () => {
		isQuitting = true
		markQuitting()
		closeAllPopouts()
		disposeAutoUpdater()
		stopSidecar()
		if (app.isPackaged) {
			restoreStdio()
		}
		app.quit()
	}
	process.on("SIGINT", shutdown)
	process.on("SIGTERM", shutdown)
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
	// 1. Reserve a free port
	const port = await reservePort()

	// 2. Generate auth token (24 random bytes = 48 hex chars)
	const authToken = crypto.randomBytes(24).toString("hex")

	// 3. Set env vars for preload to read synchronously
	process.env.LOOP_DESKTOP_SERVER_URL = `http://127.0.0.1:${port}`
	process.env.LOOP_DESKTOP_AUTH_TOKEN = authToken

	console.log(`[main] Bootstrap: port=${port}`)

	// 4. Register IPC handlers
	registerIpcHandlers(() => mainWindow, { isDev })

	// 5. Start Bun sidecar
	startSidecar({
		port,
		authToken,
		isDev,
		sidecarLogSink,
	})

	// 6. Create the main window
	mainWindow = createWindow()
}

// ── Window Creation ─────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
	const isMac = process.platform === "darwin"

	const win = new BrowserWindow({
		width: 1100,
		height: 780,
		minWidth: 840,
		minHeight: 620,
		show: false,
		title: APP_NAME,
		titleBarStyle: "hiddenInset",
		trafficLightPosition: { x: 16, y: 14 },
		autoHideMenuBar: true,
		backgroundColor: isMac ? "#00000000" : "#1a1a1a",
		...(isMac && {
			vibrancy: "under-window" as const,
			visualEffectState: "active" as const,
		}),
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	})

	// Prevent page title changes
	win.on("page-title-updated", (e) => {
		e.preventDefault()
		win.setTitle(APP_NAME)
	})

	// Show when ready (avoids white flash)
	win.once("ready-to-show", () => {
		win.show()
	})

	// Block navigation — open external URLs in the default browser
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (isValidExternalUrl(url)) {
			shell.openExternal(url)
		}
		return { action: "deny" }
	})

	win.webContents.on("will-navigate", (e, url) => {
		// Allow dev server reloads
		if (isDev && url.startsWith(VITE_DEV_SERVER_URL)) return
		// Allow custom protocol navigation
		if (url.startsWith("loop://")) return

		e.preventDefault()
		if (isValidExternalUrl(url)) {
			shell.openExternal(url)
		}
	})

	// Context menu: standard cut/copy/paste
	win.webContents.on("context-menu", (_e, params) => {
		const { editFlags } = params
		const template: Electron.MenuItemConstructorOptions[] = []

		if (params.misspelledWord) {
			for (const suggestion of params.dictionarySuggestions) {
				template.push({
					label: suggestion,
					click: () =>
						win.webContents.replaceMisspelling(suggestion),
				})
			}
			if (template.length > 0) template.push({ type: "separator" })
		}

		if (editFlags.canCut) template.push({ role: "cut" })
		if (editFlags.canCopy) template.push({ role: "copy" })
		if (editFlags.canPaste) template.push({ role: "paste" })
		if (editFlags.canSelectAll) {
			if (template.length > 0) template.push({ type: "separator" })
			template.push({ role: "selectAll" })
		}

		if (template.length > 0) {
			const { Menu } = require("electron")
			Menu.buildFromTemplate(template).popup({ window: win })
		}
	})

	// Clean up reference
	win.on("closed", () => {
		mainWindow = null
	})

	// Load content
	if (isDev) {
		win.loadURL(VITE_DEV_SERVER_URL)
		win.webContents.openDevTools({ mode: "detach" })
	} else {
		win.loadURL("loop://app/index.html")
	}

	return win
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getLogDir(): string {
	const xdg = process.env.XDG_DATA_HOME
	if (xdg) return path.join(xdg, "loop", "logs")
	const home = require("node:os").homedir()
	return path.join(home, ".local", "share", "loop", "logs")
}

function isValidExternalUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		return parsed.protocol === "http:" || parsed.protocol === "https:"
	} catch {
		return false
	}
}

function handleFatalError(stage: string, error: unknown): void {
	const { dialog } = require("electron")
	const message =
		error instanceof Error ? error.message : String(error)

	console.error(`[main] Fatal error in ${stage}:`, message)

	try {
		dialog.showErrorBox(
			"Loop failed to start",
			`An error occurred during ${stage}:\n\n${message}`,
		)
	} catch {
		// Dialog may not be available during early startup
	}

	stopSidecar()
	app.quit()
}

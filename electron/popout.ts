/**
 * Popout window manager.
 *
 * Tracks popout BrowserWindows keyed by sessionId.
 * Prevents duplicate popouts for the same session.
 * Handles lifecycle, positioning, and cleanup.
 */

import * as path from "node:path"
import { BrowserWindow, screen, shell } from "electron"
import { type PopoutContext, IPC } from "./types"

const VITE_DEV_SERVER_URL =
	process.env.VITE_DEV_SERVER_URL || "http://localhost:1420"

const isMac = process.platform === "darwin"

/** sessionId → popout BrowserWindow */
const popouts = new Map<string, BrowserWindow>()

/** directory → file-panel popout BrowserWindow */
const filePanelPopouts = new Map<string, BrowserWindow>()

/**
 * Open a popout window for a session.
 * If one already exists for this sessionId, focus it instead.
 * Returns true if a new window was created, false if an existing one was focused.
 */
export function openPopout(
	ctx: PopoutContext,
	opts: { isDev: boolean; getMainWindow: () => BrowserWindow | null },
): boolean {
	const existing = popouts.get(ctx.sessionId)
	if (existing && !existing.isDestroyed()) {
		existing.focus()
		return false
	}

	const mainWin = opts.getMainWindow()
	const bounds = computePopoutBounds(mainWin)

	const win = new BrowserWindow({
		...bounds,
		minWidth: 480,
		minHeight: 400,
		show: false,
		alwaysOnTop: true,
		title: ctx.title || "Loop",
		titleBarStyle: isMac ? "hiddenInset" : "default",
		trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
		autoHideMenuBar: true,
		backgroundColor: isMac ? "#00000000" : "#111111",
		...(isMac && {
			vibrancy: "under-window" as const,
			visualEffectState: "active" as const,
		}),
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			additionalArguments: [
				`--popout-session=${ctx.sessionId}`,
				`--popout-directory=${ctx.directory}`,
				`--popout-title=${ctx.title}`,
			],
		},
	})

	popouts.set(ctx.sessionId, win)

	// Prevent page title changes
	win.on("page-title-updated", (e) => {
		e.preventDefault()
		win.setTitle(ctx.title || "Loop")
	})

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
		if (opts.isDev && url.startsWith(VITE_DEV_SERVER_URL)) return
		if (url.startsWith("loop://")) return
		e.preventDefault()
		if (isValidExternalUrl(url)) {
			shell.openExternal(url)
		}
	})

	// Cleanup on close
	win.on("closed", () => {
		popouts.delete(ctx.sessionId)
	})

	// Load the popout route
	const dir = encodeURIComponent(ctx.directory)
	const route = `/popout/${dir}/session/${ctx.sessionId}`

	if (opts.isDev) {
		win.loadURL(`${VITE_DEV_SERVER_URL}#${route}`)
	} else {
		win.loadURL(`loop://app/index.html#${route}`)
	}

	return true
}

/**
 * Close a popout window for a session and optionally navigate
 * the main window to that session.
 */
export function returnToMain(
	sessionId: string,
	directory: string,
	getMainWindow: () => BrowserWindow | null,
): boolean {
	const mainWin = getMainWindow()
	if (!mainWin || mainWin.isDestroyed()) return false

	// Focus and bring main window to front
	if (mainWin.isMinimized()) mainWin.restore()
	mainWin.focus()

	// Tell the main window renderer to navigate to this session
	mainWin.webContents.send(IPC.NAVIGATE_TO_SESSION, sessionId, directory)

	// Close the popout
	closePopout(sessionId)
	return true
}

/** Close a specific popout window. */
export function closePopout(sessionId: string): void {
	const win = popouts.get(sessionId)
	if (win && !win.isDestroyed()) {
		win.close()
	}
	popouts.delete(sessionId)
}

/** Close the popout that owns a specific BrowserWindow. */
export function closePopoutByWindow(win: BrowserWindow): void {
	for (const [sessionId, popoutWin] of popouts) {
		if (popoutWin === win) {
			popouts.delete(sessionId)
			if (!win.isDestroyed()) win.close()
			return
		}
	}
}

/**
 * Open a file panel popout window for a workspace directory.
 * If one already exists for this directory, focus it instead.
 */
export function openFilePanelPopout(
	ctx: { directory: string; title: string },
	opts: { isDev: boolean; getMainWindow: () => BrowserWindow | null },
): boolean {
	const existing = filePanelPopouts.get(ctx.directory)
	if (existing && !existing.isDestroyed()) {
		existing.focus()
		return false
	}

	const mainWin = opts.getMainWindow()
	const bounds = computePopoutBounds(mainWin)

	const win = new BrowserWindow({
		...bounds,
		width: 900,
		height: 700,
		minWidth: 600,
		minHeight: 400,
		show: false,
		title: `Files — ${ctx.title || "Loop"}`,
		titleBarStyle: isMac ? "hiddenInset" : "default",
		trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
		autoHideMenuBar: true,
		backgroundColor: isMac ? "#00000000" : "#111111",
		...(isMac && {
			vibrancy: "under-window" as const,
			visualEffectState: "active" as const,
		}),
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			additionalArguments: [
				`--popout-type=file-panel`,
				`--popout-directory=${ctx.directory}`,
				`--popout-title=${ctx.title}`,
			],
		},
	})

	filePanelPopouts.set(ctx.directory, win)

	win.on("page-title-updated", (e) => {
		e.preventDefault()
		win.setTitle(`Files — ${ctx.title || "Loop"}`)
	})

	win.once("ready-to-show", () => {
		win.show()
	})

	win.webContents.setWindowOpenHandler(({ url }) => {
		if (isValidExternalUrl(url)) {
			shell.openExternal(url)
		}
		return { action: "deny" }
	})

	win.webContents.on("will-navigate", (e, url) => {
		if (opts.isDev && url.startsWith(VITE_DEV_SERVER_URL)) return
		if (url.startsWith("loop://")) return
		e.preventDefault()
		if (isValidExternalUrl(url)) {
			shell.openExternal(url)
		}
	})

	win.on("closed", () => {
		filePanelPopouts.delete(ctx.directory)
	})

	const dir = encodeURIComponent(ctx.directory)
	const route = `/popout/${dir}/file-panel`

	if (opts.isDev) {
		win.loadURL(`${VITE_DEV_SERVER_URL}#${route}`)
	} else {
		win.loadURL(`loop://app/index.html#${route}`)
	}

	return true
}

/** Close all popout windows (used during shutdown). */
export function closeAllPopouts(): void {
	for (const [sessionId, win] of popouts) {
		if (!win.isDestroyed()) win.close()
		popouts.delete(sessionId)
	}
	for (const [dir, win] of filePanelPopouts) {
		if (!win.isDestroyed()) win.close()
		filePanelPopouts.delete(dir)
	}
}

/** Check if any popout windows are open. */
export function hasPopouts(): boolean {
	for (const win of popouts.values()) {
		if (!win.isDestroyed()) return true
	}
	for (const win of filePanelPopouts.values()) {
		if (!win.isDestroyed()) return true
	}
	return false
}

/** Get the sessionId for a popout BrowserWindow. */
export function getPopoutSessionId(win: BrowserWindow): string | null {
	for (const [sessionId, popoutWin] of popouts) {
		if (popoutWin === win) return sessionId
	}
	return null
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Compute bounds for the popout window.
 * Positions it offset from the main window, or centered on primary display.
 */
function computePopoutBounds(mainWin: BrowserWindow | null): {
	width: number
	height: number
	x?: number
	y?: number
} {
	const width = 720
	const height = 640

	if (mainWin && !mainWin.isDestroyed()) {
		const [mainX, mainY] = mainWin.getPosition()
		const [mainW] = mainWin.getSize()
		const display = screen.getDisplayMatching(mainWin.getBounds())
		const { x: dX, y: dY, width: dW, height: dH } = display.workArea

		// Try to place to the right of the main window
		let x = mainX + mainW + 20
		let y = mainY + 40

		// If it would go offscreen, place to the left
		if (x + width > dX + dW) {
			x = mainX - width - 20
		}
		// If still offscreen, center on display
		if (x < dX) {
			x = dX + Math.round((dW - width) / 2)
		}
		// Clamp vertical
		if (y + height > dY + dH) {
			y = dY + dH - height - 20
		}
		if (y < dY) {
			y = dY + 20
		}

		return { width, height, x, y }
	}

	// No main window — center on primary display
	const primary = screen.getPrimaryDisplay()
	const { x: dX, y: dY, width: dW, height: dH } = primary.workArea
	return {
		width,
		height,
		x: dX + Math.round((dW - width) / 2),
		y: dY + Math.round((dH - height) / 2),
	}
}

function isValidExternalUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		return parsed.protocol === "http:" || parsed.protocol === "https:"
	} catch {
		return false
	}
}

/**
 * Preload script — runs in a privileged context before the renderer.
 *
 * Exposes `window.desktopBridge` via contextBridge so the renderer
 * can communicate with the main process through typed IPC channels.
 * The renderer never has direct access to Node.js APIs.
 */

import { contextBridge, ipcRenderer } from "electron"
import type { PopoutContext } from "./types"
import { IPC } from "./types"

// ── Parse popout context from additionalArguments ────────────────────────

function parsePopoutContext(): PopoutContext | null {
	const args = process.argv
	let sessionId: string | null = null
	let directory: string | null = null
	let title: string | null = null

	for (const arg of args) {
		if (arg.startsWith("--popout-session=")) {
			sessionId = arg.slice("--popout-session=".length)
		} else if (arg.startsWith("--popout-directory=")) {
			directory = arg.slice("--popout-directory=".length)
		} else if (arg.startsWith("--popout-title=")) {
			title = arg.slice("--popout-title=".length)
		}
	}

	if (sessionId && directory) {
		return { sessionId, directory, title: title ?? "" }
	}
	return null
}

const popoutContext = parsePopoutContext()

contextBridge.exposeInMainWorld("desktopBridge", {
	// ── Server info ──
	// Synchronous read from env vars set by main process before window creation.
	getServerInfo: () => ({
		url: process.env.LOOP_DESKTOP_SERVER_URL ?? "",
		token: process.env.LOOP_DESKTOP_AUTH_TOKEN ?? "",
	}),

	// ── Dialogs ──
	pickFolder: () => ipcRenderer.invoke(IPC.PICK_FOLDER),
	confirm: (message: string) => ipcRenderer.invoke(IPC.CONFIRM, message),

	// ── Theme ──
	setTheme: (theme: string) => ipcRenderer.invoke(IPC.SET_THEME, theme),

	// ── Context menu ──
	showContextMenu: (
		items: Array<{
			id: string
			label: string
			destructive?: boolean
			disabled?: boolean
		}>,
		position?: { x: number; y: number },
	) => ipcRenderer.invoke(IPC.CONTEXT_MENU, items, position),

	// ── External links ──
	openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),

	// ── Menu actions (main → renderer) ──
	onMenuAction: (listener: (action: string) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, action: unknown) => {
			if (typeof action !== "string") return
			listener(action)
		}
		ipcRenderer.on(IPC.MENU_ACTION, handler)
		return () => {
			ipcRenderer.removeListener(IPC.MENU_ACTION, handler)
		}
	},

	// ── Auto-update ──
	getUpdateState: () => ipcRenderer.invoke(IPC.UPDATE_GET_STATE),
	downloadUpdate: () => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
	installUpdate: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL),
	onUpdateState: (listener: (state: unknown) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
			if (typeof state !== "object" || state === null) return
			listener(state)
		}
		ipcRenderer.on(IPC.UPDATE_STATE, handler)
		return () => {
			ipcRenderer.removeListener(IPC.UPDATE_STATE, handler)
		}
	},

	// ── Popout windows ──
	popoutSession: (sessionId: string, directory: string, title: string) =>
		ipcRenderer.invoke(IPC.POPOUT_SESSION, sessionId, directory, title),
	returnToMain: (sessionId: string) => ipcRenderer.invoke(IPC.RETURN_TO_MAIN, sessionId),
	closePopout: () => ipcRenderer.invoke(IPC.CLOSE_POPOUT),
	isPopout: () => popoutContext !== null,
	getPopoutContext: () => popoutContext,

	// ── Navigate to session (main → renderer, used by "Return to Main") ──
	onNavigateToSession: (listener: (sessionId: string) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, sessionId: unknown) => {
			if (typeof sessionId !== "string") return
			listener(sessionId)
		}
		ipcRenderer.on(IPC.NAVIGATE_TO_SESSION, handler)
		return () => {
			ipcRenderer.removeListener(IPC.NAVIGATE_TO_SESSION, handler)
		}
	},
})

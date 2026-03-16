/**
 * Preload script — runs in a privileged context before the renderer.
 *
 * Exposes `window.desktopBridge` via contextBridge so the renderer
 * can communicate with the main process through typed IPC channels.
 * The renderer never has direct access to Node.js APIs.
 */

import { contextBridge, ipcRenderer } from "electron"
import { IPC } from "./types"

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
})

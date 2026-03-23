/**
 * IPC handler registration.
 *
 * All handlers use removeHandler + handle to be idempotent (safe to call
 * multiple times, e.g. on window recreation). Input validation happens
 * here — the renderer receives clean typed responses.
 */

import { BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from "electron"
import { closePopoutByWindow, openPopout, returnToMain } from "./popout"
import type { ContextMenuItem, DesktopTheme } from "./types"
import { IPC } from "./types"

export function registerIpcHandlers(
	getMainWindow: () => BrowserWindow | null,
	opts: { isDev: boolean },
): void {
	// Remove any existing handlers (idempotent registration)
	for (const channel of Object.values(IPC)) {
		try {
			ipcMain.removeHandler(channel)
		} catch {
			// No handler to remove
		}
	}

	// ── Pick folder ──
	ipcMain.handle(IPC.PICK_FOLDER, async () => {
		const win = getMainWindow()
		if (!win) return null

		const result = await dialog.showOpenDialog(win, {
			properties: ["openDirectory", "createDirectory"],
		})

		if (result.canceled || result.filePaths.length === 0) return null
		return result.filePaths[0]
	})

	// ── Confirm dialog ──
	ipcMain.handle(IPC.CONFIRM, async (_event, message: unknown) => {
		if (typeof message !== "string") return false
		const win = getMainWindow()
		if (!win) return false

		const result = await dialog.showMessageBox(win, {
			type: "question",
			buttons: ["OK", "Cancel"],
			defaultId: 0,
			cancelId: 1,
			message,
		})
		return result.response === 0
	})

	// ── Theme ──
	ipcMain.handle(IPC.SET_THEME, (_event, theme: unknown) => {
		if (theme !== "light" && theme !== "dark" && theme !== "system") return
		nativeTheme.themeSource = theme as DesktopTheme
	})

	// ── Context menu ──
	ipcMain.handle(IPC.CONTEXT_MENU, async (_event, items: unknown, position: unknown) => {
		if (!Array.isArray(items)) return null
		const win = getMainWindow()
		if (!win) return null

		return new Promise<string | null>((resolve) => {
			const template: Electron.MenuItemConstructorOptions[] = []
			let hasDestructive = false

			for (const item of items as ContextMenuItem[]) {
				if (!item || typeof item.id !== "string") continue

				if (item.destructive && !hasDestructive) {
					hasDestructive = true
					template.push({ type: "separator" })
				}

				template.push({
					label: item.label,
					enabled: !item.disabled,
					click: () => resolve(item.id),
				})
			}

			const menu = Menu.buildFromTemplate(template)
			menu.on("menu-will-close", () => {
				// Resolve null if nothing was clicked (delayed to let click fire first)
				setTimeout(() => resolve(null), 100)
			})

			const popupOpts: Electron.PopupOptions = { window: win }
			if (position && typeof position === "object" && "x" in position && "y" in position) {
				const pos = position as { x: number; y: number }
				popupOpts.x = Math.round(pos.x)
				popupOpts.y = Math.round(pos.y)
			}

			menu.popup(popupOpts)
		})
	})

	// ── Open external URL ──
	ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: unknown) => {
		if (typeof url !== "string") return false

		const safeUrl = getSafeExternalUrl(url)
		if (!safeUrl) return false

		try {
			await shell.openExternal(safeUrl)
			return true
		} catch {
			return false
		}
	})

	// ── Popout session ──
	ipcMain.handle(
		IPC.POPOUT_SESSION,
		(_event, sessionId: unknown, directory: unknown, title: unknown) => {
			if (typeof sessionId !== "string" || typeof directory !== "string") {
				return false
			}
			return openPopout(
				{
					sessionId,
					directory,
					title: typeof title === "string" ? title : "",
				},
				{ isDev: opts.isDev, getMainWindow },
			)
		},
	)

	// ── Return to main window ──
	ipcMain.handle(IPC.RETURN_TO_MAIN, (_event, sessionId: unknown) => {
		if (typeof sessionId !== "string") return false
		return returnToMain(sessionId, getMainWindow)
	})

	// ── Close popout (called from within a popout renderer) ──
	ipcMain.handle(IPC.CLOSE_POPOUT, (event) => {
		const win = BrowserWindow.fromWebContents(event.sender)
		if (win) closePopoutByWindow(win)
	})
}

/**
 * Dispatch a menu action to the renderer via IPC.
 * Used by the application menu to notify the frontend of user actions.
 */
export function dispatchMenuAction(win: BrowserWindow | null, action: string): void {
	if (!win) return
	win.webContents.send(IPC.MENU_ACTION, action)
}

// ── URL Validation ──────────────────────────────────────────────────────────

function getSafeExternalUrl(raw: string): string | null {
	try {
		const url = new URL(raw)
		if (url.protocol !== "http:" && url.protocol !== "https:") return null
		return url.toString()
	} catch {
		return null
	}
}

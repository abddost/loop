/**
 * Application menu builder.
 *
 * Builds the native menu bar with platform-appropriate items.
 * Menu actions (Settings, Check for Updates) are dispatched to
 * the renderer via IPC.
 */

import { type BrowserWindow, Menu, app } from "electron"
import { dispatchMenuAction } from "./ipc"

const isMac = process.platform === "darwin"

export function configureApplicationMenu(
	getMainWindow: () => BrowserWindow | null,
	onCheckForUpdates?: () => void,
): void {
	const template: Electron.MenuItemConstructorOptions[] = []

	// ── macOS app menu ──
	if (isMac) {
		template.push({
			label: app.name,
			submenu: [
				{ role: "about" },
				...(onCheckForUpdates
					? [
							{
								label: "Check for Updates...",
								click: onCheckForUpdates,
							} satisfies Electron.MenuItemConstructorOptions,
						]
					: []),
				{ type: "separator" as const },
				{
					label: "Settings...",
					accelerator: "CmdOrCtrl+,",
					click: () => dispatchMenuAction(getMainWindow(), "open-settings"),
				},
				{ type: "separator" as const },
				{ role: "services" as const },
				{ type: "separator" as const },
				{ role: "hide" as const },
				{ role: "hideOthers" as const },
				{ role: "unhide" as const },
				{ type: "separator" as const },
				{ role: "quit" as const },
			],
		})
	}

	// ── File menu ──
	template.push({
		label: "File",
		submenu: [
			...(!isMac
				? [
						{
							label: "Settings",
							accelerator: "CmdOrCtrl+,",
							click: () =>
								dispatchMenuAction(getMainWindow(), "open-settings"),
						} satisfies Electron.MenuItemConstructorOptions,
						{ type: "separator" as const },
					]
				: []),
			isMac ? { role: "close" as const } : { role: "quit" as const },
		],
	})

	// ── Edit menu ──
	template.push({
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	})

	// ── View menu ──
	template.push({
		label: "View",
		submenu: [
			{ role: "reload" },
			{ role: "forceReload" },
			{ role: "toggleDevTools" },
			{ type: "separator" },
			{ role: "resetZoom" },
			{ role: "zoomIn" },
			{ role: "zoomOut" },
			{ type: "separator" },
			{ role: "togglefullscreen" },
		],
	})

	// ── Window menu ──
	template.push({
		label: "Window",
		submenu: [
			{ role: "minimize" },
			{ role: "zoom" },
			...(isMac
				? [
						{ type: "separator" as const },
						{ role: "front" as const },
					]
				: [{ role: "close" as const }]),
		],
	})

	// ── Help menu ──
	template.push({
		label: "Help",
		submenu: [
			...(onCheckForUpdates
				? [
						{
							label: "Check for Updates...",
							click: onCheckForUpdates,
						} satisfies Electron.MenuItemConstructorOptions,
					]
				: []),
		],
	})

	const menu = Menu.buildFromTemplate(template)
	Menu.setApplicationMenu(menu)
}

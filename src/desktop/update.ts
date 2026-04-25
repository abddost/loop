/**
 * Auto-update state machine using electron-updater.
 *
 * Manual download control (no auto-download, no auto-install).
 * 15s startup delay, 4hr poll interval. Disabled in dev, non-packaged,
 * or Linux without AppImage.
 */

import { type BrowserWindow, app, dialog } from "electron"
import { autoUpdater } from "electron-updater"
import type { DesktopUpdateActionResult, DesktopUpdateState } from "./types"
import { IPC } from "./types"

const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1_000 // 4 hours

let updateState: DesktopUpdateState = {
	enabled: false,
	status: "disabled",
	currentVersion: "",
	availableVersion: null,
	downloadedVersion: null,
	downloadPercent: null,
	checkedAt: null,
	message: null,
	errorContext: null,
	canRetry: false,
}

let startupTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let getMainWindow: (() => BrowserWindow | null) | null = null

// ── Public API ──────────────────────────────────────────────────────────────

export function configureAutoUpdater(
	mainWindowGetter: () => BrowserWindow | null,
): void {
	getMainWindow = mainWindowGetter

	const enabled = isAutoUpdateEnabled()
	updateState = {
		...updateState,
		enabled,
		status: enabled ? "idle" : "disabled",
		currentVersion: app.getVersion(),
	}

	if (!enabled) return

	autoUpdater.autoDownload = false
	autoUpdater.autoInstallOnAppQuit = false
	autoUpdater.allowPrerelease = false
	autoUpdater.allowDowngrade = false

	// GitHub token for private repos
	const ghToken =
		process.env.LOOP_UPDATE_GITHUB_TOKEN || process.env.GH_TOKEN
	if (ghToken) {
		autoUpdater.setFeedURL({
			provider: "github",
			owner: "",
			repo: "",
			private: true,
			token: ghToken,
		})
	}

	// ── Event listeners ──
	autoUpdater.on("checking-for-update", () => {
		setState({ status: "checking", message: null, errorContext: null })
	})

	autoUpdater.on("update-available", (info) => {
		setState({
			status: "available",
			availableVersion: info.version,
			checkedAt: new Date().toISOString(),
		})
	})

	autoUpdater.on("update-not-available", () => {
		setState({
			status: "up-to-date",
			checkedAt: new Date().toISOString(),
		})
	})

	autoUpdater.on("error", (err) => {
		const ctx = updateState.errorContext ?? "check"
		setState({
			status: "error",
			message: err.message,
			errorContext: ctx,
			canRetry: true,
		})
	})

	autoUpdater.on("download-progress", (progress) => {
		// Throttle to 10% milestones
		const pct = Math.round(progress.percent)
		if (
			updateState.downloadPercent !== null &&
			Math.floor(pct / 10) === Math.floor(updateState.downloadPercent / 10)
		) {
			return
		}
		setState({
			status: "downloading",
			downloadPercent: pct,
		})
	})

	autoUpdater.on("update-downloaded", (info) => {
		setState({
			status: "downloaded",
			downloadedVersion: info.version,
			downloadPercent: 100,
		})
	})

	// ── Polling ──
	startupTimer = setTimeout(() => {
		startupTimer = null
		checkForUpdates()
		pollTimer = setInterval(checkForUpdates, AUTO_UPDATE_POLL_INTERVAL_MS)
		pollTimer.unref()
	}, AUTO_UPDATE_STARTUP_DELAY_MS)
	startupTimer.unref()
}

export function getUpdateState(): DesktopUpdateState {
	return { ...updateState }
}

export async function downloadUpdate(): Promise<DesktopUpdateActionResult> {
	if (updateState.status !== "available") {
		return { ok: false, message: "No update available to download" }
	}
	try {
		setState({ errorContext: "download" })
		await autoUpdater.downloadUpdate()
		return { ok: true }
	} catch (err) {
		return { ok: false, message: String(err) }
	}
}

export async function installUpdate(): Promise<DesktopUpdateActionResult> {
	if (updateState.status !== "downloaded") {
		return { ok: false, message: "No update downloaded to install" }
	}
	try {
		setState({ errorContext: "install" })
		autoUpdater.quitAndInstall(false, true)
		return { ok: true }
	} catch (err) {
		return { ok: false, message: String(err) }
	}
}

export async function checkForUpdatesFromMenu(): Promise<void> {
	const win = getMainWindow?.()
	try {
		const result = await autoUpdater.checkForUpdates()
		if (!result || result.updateInfo.version === app.getVersion()) {
			if (win) {
				await dialog.showMessageBox(win, {
					type: "info",
					message: "You're up to date!",
					detail: `Loop ${app.getVersion()} is the latest version.`,
				})
			}
		}
	} catch (err) {
		if (win) {
			await dialog.showMessageBox(win, {
				type: "error",
				message: "Update check failed",
				detail: String(err),
			})
		}
	}
}

export function disposeAutoUpdater(): void {
	if (startupTimer) {
		clearTimeout(startupTimer)
		startupTimer = null
	}
	if (pollTimer) {
		clearInterval(pollTimer)
		pollTimer = null
	}
}

// ── Internal ────────────────────────────────────────────────────────────────

function isAutoUpdateEnabled(): boolean {
	if (!app.isPackaged) return false
	if (process.env.LOOP_DISABLE_AUTO_UPDATE === "1") return false
	// Linux: only AppImage supports auto-update
	if (process.platform === "linux" && !process.env.APPIMAGE) return false
	return true
}

function checkForUpdates(): void {
	autoUpdater.checkForUpdates().catch((err) => {
		console.error("[update] Check failed:", err)
	})
}

function setState(patch: Partial<DesktopUpdateState>): void {
	updateState = { ...updateState, ...patch }
	broadcastState()
}

function broadcastState(): void {
	const win = getMainWindow?.()
	if (win && !win.isDestroyed()) {
		win.webContents.send(IPC.UPDATE_STATE, { ...updateState })
	}
}

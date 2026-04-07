// ── Desktop Bridge ──────────────────────────────────────────────────────────

export interface DesktopBridge {
	getServerInfo(): { url: string; token: string }
	pickFolder(): Promise<string | null>
	confirm(message: string): Promise<boolean>
	setTheme(theme: DesktopTheme): Promise<void>
	showContextMenu<T extends string>(
		items: ContextMenuItem<T>[],
		position?: { x: number; y: number },
	): Promise<T | null>
	openExternal(url: string): Promise<boolean>
	onMenuAction(listener: (action: string) => void): () => void
	getUpdateState(): Promise<DesktopUpdateState>
	downloadUpdate(): Promise<DesktopUpdateActionResult>
	installUpdate(): Promise<DesktopUpdateActionResult>
	onUpdateState(listener: (state: DesktopUpdateState) => void): () => void

	// ── Popout windows ──
	/** Open a session in a popout window (or focus existing). */
	popoutSession(sessionId: string, directory: string, title: string): Promise<boolean>
	/** Open the file panel in a popout window. */
	popoutFilePanel(directory: string, title: string): Promise<boolean>
	/** Move session back to main window and close the popout. */
	returnToMain(sessionId: string): Promise<boolean>
	/** Close the current popout window. */
	closePopout(): Promise<void>
	/** Whether this renderer is a popout window. */
	isPopout(): boolean
	/** The popout session context (only meaningful in a popout window). */
	getPopoutContext(): PopoutContext | null
}

export type DesktopTheme = "light" | "dark" | "system"

export interface ContextMenuItem<T extends string = string> {
	id: T
	label: string
	destructive?: boolean
	disabled?: boolean
	separator?: boolean
}

// ── Auto-Update ─────────────────────────────────────────────────────────────

export type DesktopUpdateStatus =
	| "disabled"
	| "idle"
	| "checking"
	| "up-to-date"
	| "available"
	| "downloading"
	| "downloaded"
	| "error"

export interface DesktopUpdateState {
	enabled: boolean
	status: DesktopUpdateStatus
	currentVersion: string
	availableVersion: string | null
	downloadedVersion: string | null
	downloadPercent: number | null
	checkedAt: string | null
	message: string | null
	errorContext: "check" | "download" | "install" | null
	canRetry: boolean
}

export interface DesktopUpdateActionResult {
	ok: boolean
	message?: string
}

// ── Popout Context ──────────────────────────────────────────────────────────

export interface PopoutContext {
	sessionId: string
	directory: string
	title: string
	type?: "session" | "file-panel"
}

// ── IPC Channels ────────────────────────────────────────────────────────────

export const IPC = {
	PICK_FOLDER: "desktop:pick-folder",
	CONFIRM: "desktop:confirm",
	SET_THEME: "desktop:set-theme",
	CONTEXT_MENU: "desktop:context-menu",
	OPEN_EXTERNAL: "desktop:open-external",
	MENU_ACTION: "desktop:menu-action",
	UPDATE_GET_STATE: "desktop:update-get-state",
	UPDATE_DOWNLOAD: "desktop:update-download",
	UPDATE_INSTALL: "desktop:update-install",
	UPDATE_STATE: "desktop:update-state",

	// Popout windows
	POPOUT_SESSION: "desktop:popout-session",
	POPOUT_FILE_PANEL: "desktop:popout-file-panel",
	RETURN_TO_MAIN: "desktop:return-to-main",
	CLOSE_POPOUT: "desktop:close-popout",
	NAVIGATE_TO_SESSION: "desktop:navigate-to-session",
} as const

// ── Sidecar Config ──────────────────────────────────────────────────────────

export interface SidecarConfig {
	port: number
	authToken: string
	isDev: boolean
	sidecarLogSink?: RotatingFileSinkLike | null
	onCrash?: (reason: string) => void
}

export interface RotatingFileSinkLike {
	write(data: string): void
}

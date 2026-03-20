import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { apiClient } from "../lib/api-client"

export interface TerminalInfo {
	id: string
	title: string
	shell: string
	cwd: string
}

interface TerminalState {
	/** Server connection info for WebSocket */
	serverUrl: string
	authToken: string

	/** Terminal panel UI state */
	panelOpen: boolean
	panelHeight: number

	/** Current workspace directory */
	activeDir: string | null

	/** Per-workspace terminal tracking */
	terminalsByDir: Record<string, TerminalInfo[]>
	activeTerminalByDir: Record<string, string | null>

	/** Initialize with server info */
	init(url: string, token: string): void

	/** Panel controls */
	togglePanel(): void
	setPanelHeight(height: number): void

	/**
	 * Switch to a workspace. Fetches existing terminals from the server
	 * so they persist across session/workspace navigation.
	 */
	switchWorkspace(dir: string): void

	/** Terminal lifecycle */
	createTerminal(): Promise<TerminalInfo>
	closeTerminal(id: string): Promise<void>
	setActiveTerminal(id: string): void
}

const MIN_PANEL_HEIGHT = 150
const MAX_PANEL_HEIGHT = 600
const DEFAULT_PANEL_HEIGHT = 300

/** Stable empty array — prevents new-reference re-renders in selectors */
const EMPTY_TERMINALS: TerminalInfo[] = []

export const useTerminalStore = create<TerminalState>()(
	immer((set, get) => ({
		serverUrl: "",
		authToken: "",
		panelOpen: false,
		panelHeight: DEFAULT_PANEL_HEIGHT,
		activeDir: null,
		terminalsByDir: {},
		activeTerminalByDir: {},

		init(url, token) {
			set((s) => {
				s.serverUrl = url
				s.authToken = token
			})
		},

		togglePanel() {
			const state = get()
			const willOpen = !state.panelOpen
			const dir = state.activeDir
			set((s) => {
				s.panelOpen = willOpen
			})
			// Auto-create first terminal when opening empty panel
			const terminals = dir ? state.terminalsByDir[dir] : undefined
			if (willOpen && (!terminals || terminals.length === 0)) {
				get()
					.createTerminal()
					.catch((err) => console.error("[terminal] Failed to create terminal:", err))
			}
		},

		setPanelHeight(height) {
			const clamped = Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, height))
			set((s) => {
				s.panelHeight = clamped
			})
		},

		switchWorkspace(dir) {
			const prev = get().activeDir
			if (prev === dir) return

			// Eagerly initialize workspace entries so selectors never hit ?? fallback
			set((s) => {
				s.activeDir = dir
				if (!s.terminalsByDir[dir]) {
					s.terminalsByDir[dir] = []
				}
				if (s.activeTerminalByDir[dir] === undefined) {
					s.activeTerminalByDir[dir] = null
				}
				// Close panel when switching to workspace with no cached terminals
				// (will re-open if server confirms terminals exist)
				if (s.terminalsByDir[dir].length === 0) {
					s.panelOpen = false
				}
			})

			// Fetch existing terminals from server for this workspace
			apiClient
				.get<TerminalInfo[]>("/terminals", { directory: dir })
				.then((list) => {
					// Only apply if still on this workspace
					if (get().activeDir !== dir) return
					set((s) => {
						s.terminalsByDir[dir] = list
						if (!s.activeTerminalByDir[dir] && list.length > 0) {
							s.activeTerminalByDir[dir] = list[0].id
						}
						// Re-open panel if server has terminals for this workspace
						if (list.length > 0) {
							s.panelOpen = true
						}
					})
				})
				.catch((err) => console.error("[terminal] Failed to fetch terminals:", err))
		},

		async createTerminal() {
			const dir = get().activeDir
			if (!dir) throw new Error("No active workspace")
			const info = await apiClient.post<TerminalInfo>("/terminals")
			set((s) => {
				if (!s.terminalsByDir[dir]) {
					s.terminalsByDir[dir] = []
				}
				s.terminalsByDir[dir].push(info)
				s.activeTerminalByDir[dir] = info.id
			})
			return info
		},

		async closeTerminal(id) {
			const dir = get().activeDir
			if (!dir) return
			await apiClient.del(`/terminals/${id}`)
			set((s) => {
				const list = s.terminalsByDir[dir]
				if (!list) return
				s.terminalsByDir[dir] = list.filter((t) => t.id !== id)
				if (s.activeTerminalByDir[dir] === id) {
					const remaining = s.terminalsByDir[dir]
					s.activeTerminalByDir[dir] =
						remaining.length > 0 ? remaining[remaining.length - 1].id : null
				}
				if (s.terminalsByDir[dir].length === 0) {
					s.panelOpen = false
				}
			})
		},

		setActiveTerminal(id) {
			const dir = get().activeDir
			if (!dir) return
			set((s) => {
				s.activeTerminalByDir[dir] = id
			})
		},
	})),
)

/** Select terminals for the current workspace (stable reference) */
export function selectTerminals(s: TerminalState): TerminalInfo[] {
	if (!s.activeDir) return EMPTY_TERMINALS
	return s.terminalsByDir[s.activeDir] ?? EMPTY_TERMINALS
}

/** Select active terminal ID for the current workspace */
export function selectActiveTerminalId(s: TerminalState): string | null {
	if (!s.activeDir) return null
	return s.activeTerminalByDir[s.activeDir] ?? null
}

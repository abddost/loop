import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { apiClient } from "../lib/api-client"
import { getTerminalPanelClosed, setTerminalPanelClosed } from "../lib/local-persistence"
import {
	type TerminalGroup,
	closeFromGroups,
	hydrateGroups,
	isActiveGroupFull,
	newGroup,
	splitIntoGroup,
} from "./terminal-groups"

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

	/** Per-workspace split-group layout (UI-only, not persisted server-side) */
	terminalGroupsByDir: Record<string, TerminalGroup[]>
	activeGroupByDir: Record<string, string | null>

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
	newTerminal(): Promise<TerminalInfo>
	splitTerminal(): Promise<TerminalInfo | null>
	closeTerminal(id: string): Promise<void>
	setActiveTerminal(id: string): void
}

const MIN_PANEL_HEIGHT = 150
const MAX_PANEL_HEIGHT = 600
const DEFAULT_PANEL_HEIGHT = 300

/** Stable empty arrays — prevents new-reference re-renders in selectors */
const EMPTY_TERMINALS: TerminalInfo[] = []
const EMPTY_GROUPS: TerminalGroup[] = []
const EMPTY_VISIBLE: string[] = []

export const useTerminalStore = create<TerminalState>()(
	immer((set, get) => ({
		serverUrl: "",
		authToken: "",
		panelOpen: false,
		panelHeight: DEFAULT_PANEL_HEIGHT,
		activeDir: null,
		terminalsByDir: {},
		activeTerminalByDir: {},
		terminalGroupsByDir: {},
		activeGroupByDir: {},

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
			setTerminalPanelClosed(!willOpen)
			const terminals = dir ? state.terminalsByDir[dir] : undefined
			if (willOpen && (!terminals || terminals.length === 0)) {
				get()
					.newTerminal()
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

			const userClosed = getTerminalPanelClosed()

			set((s) => {
				s.activeDir = dir
				if (!s.terminalsByDir[dir]) s.terminalsByDir[dir] = []
				if (s.activeTerminalByDir[dir] === undefined) s.activeTerminalByDir[dir] = null
				if (!s.terminalGroupsByDir[dir]) s.terminalGroupsByDir[dir] = []
				if (s.activeGroupByDir[dir] === undefined) s.activeGroupByDir[dir] = null
				if (s.terminalsByDir[dir].length === 0) s.panelOpen = false
			})

			apiClient
				.get<TerminalInfo[]>("/terminals", { directory: dir })
				.then((list) => {
					if (get().activeDir !== dir) return
					set((s) => {
						s.terminalsByDir[dir] = list
						const groups = hydrateGroups(
							list.map((t) => t.id),
							s.terminalGroupsByDir[dir],
						)
						s.terminalGroupsByDir[dir] = groups
						if (!s.activeTerminalByDir[dir] && list.length > 0) {
							s.activeTerminalByDir[dir] = list[0].id
						}
						const activeTerm = s.activeTerminalByDir[dir]
						const activeGroup = activeTerm
							? (groups.find((g) => g.terminalIds.includes(activeTerm))?.id ?? null)
							: null
						s.activeGroupByDir[dir] = activeGroup ?? groups[0]?.id ?? null
						if (list.length > 0 && !userClosed) s.panelOpen = true
					})
				})
				.catch((err) => console.error("[terminal] Failed to fetch terminals:", err))
		},

		async newTerminal() {
			const dir = get().activeDir
			if (!dir) throw new Error("No active workspace")
			const info = await apiClient.post<TerminalInfo>("/terminals")
			set((s) => {
				if (!s.terminalsByDir[dir]) s.terminalsByDir[dir] = []
				s.terminalsByDir[dir].push(info)
				const prevGroups = s.terminalGroupsByDir[dir] ?? []
				const { groups, groupId } = newGroup(prevGroups, info.id)
				s.terminalGroupsByDir[dir] = groups
				s.activeTerminalByDir[dir] = info.id
				s.activeGroupByDir[dir] = groupId
			})
			return info
		},

		async splitTerminal() {
			const dir = get().activeDir
			if (!dir) throw new Error("No active workspace")
			const groups = get().terminalGroupsByDir[dir] ?? []
			const activeGroup = get().activeGroupByDir[dir] ?? null
			// Enforce limit before hitting the server to avoid orphan terminals
			if (isActiveGroupFull(groups, activeGroup)) return null

			const info = await apiClient.post<TerminalInfo>("/terminals")
			set((s) => {
				if (!s.terminalsByDir[dir]) s.terminalsByDir[dir] = []
				s.terminalsByDir[dir].push(info)
				const prevGroups = s.terminalGroupsByDir[dir] ?? []
				const { groups: nextGroups, groupId } = splitIntoGroup(
					prevGroups,
					info.id,
					s.activeGroupByDir[dir] ?? null,
				)
				s.terminalGroupsByDir[dir] = nextGroups
				s.activeTerminalByDir[dir] = info.id
				s.activeGroupByDir[dir] = groupId
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

				const { groups, activeTerminalId, activeGroupId } = closeFromGroups(
					s.terminalGroupsByDir[dir] ?? [],
					id,
					s.activeTerminalByDir[dir] ?? null,
					s.activeGroupByDir[dir] ?? null,
				)
				s.terminalGroupsByDir[dir] = groups
				s.activeTerminalByDir[dir] = activeTerminalId
				s.activeGroupByDir[dir] = activeGroupId

				if (s.terminalsByDir[dir].length === 0) {
					s.panelOpen = false
					setTerminalPanelClosed(true)
				}
			})
		},

		setActiveTerminal(id) {
			const dir = get().activeDir
			if (!dir) return
			set((s) => {
				s.activeTerminalByDir[dir] = id
				const groupId = (s.terminalGroupsByDir[dir] ?? []).find((g) =>
					g.terminalIds.includes(id),
				)?.id
				if (groupId) s.activeGroupByDir[dir] = groupId
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

/** Select the split-group layout for the current workspace */
export function selectTerminalGroups(s: TerminalState): TerminalGroup[] {
	if (!s.activeDir) return EMPTY_GROUPS
	return s.terminalGroupsByDir[s.activeDir] ?? EMPTY_GROUPS
}

/** Select the active group ID for the current workspace */
export function selectActiveGroupId(s: TerminalState): string | null {
	if (!s.activeDir) return null
	return s.activeGroupByDir[s.activeDir] ?? null
}

/** Select the terminal IDs visible in the split grid (active group's terminals) */
export function selectVisibleTerminalIds(s: TerminalState): string[] {
	if (!s.activeDir) return EMPTY_VISIBLE
	const groups = s.terminalGroupsByDir[s.activeDir]
	const activeGroupId = s.activeGroupByDir[s.activeDir]
	if (!groups || !activeGroupId) return EMPTY_VISIBLE
	return groups.find((g) => g.id === activeGroupId)?.terminalIds ?? EMPTY_VISIBLE
}

/** Is the current active group at the MAX_TERMINALS_PER_GROUP limit? */
export function selectIsActiveGroupFull(s: TerminalState): boolean {
	if (!s.activeDir) return false
	return isActiveGroupFull(
		s.terminalGroupsByDir[s.activeDir] ?? [],
		s.activeGroupByDir[s.activeDir] ?? null,
	)
}

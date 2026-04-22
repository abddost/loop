import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { setLastDirectory, setLastProjectId, setLastSessionId } from "../lib/local-persistence"

interface UIState {
	sidebarOpen: boolean
	sidebarWidth: number
	activeProjectId: string | null
	activeSessionId: string | null
	activeDirectory: string | null

	toggleSidebar(): void
	setSidebarWidth(width: number): void
	setActiveProject(id: string | null): void
	setActiveSession(id: string | null): void
	setActiveDirectory(dir: string | null): void
}

export const useUIStore = create<UIState>()(
	immer((set) => ({
		sidebarOpen: true,
		sidebarWidth: 260,
		activeProjectId: null,
		activeSessionId: null,
		activeDirectory: null,

		toggleSidebar() {
			set((s) => {
				s.sidebarOpen = !s.sidebarOpen
			})
		},
		setSidebarWidth(width) {
			set((s) => {
				s.sidebarWidth = width
			})
		},
		setActiveProject(id) {
			set((s) => {
				s.activeProjectId = id
			})
			setLastProjectId(id)
		},
		setActiveSession(id) {
			set((s) => {
				s.activeSessionId = id
			})
			setLastSessionId(id)
		},
		setActiveDirectory(dir) {
			set((s) => {
				s.activeDirectory = dir
			})
			setLastDirectory(dir)
		},
	})),
)

import { create } from "zustand"

/**
 * UI state for the background-subagent progress panel. Independent of the
 * file panel so the user can toggle them separately.
 *
 * Focused task is the `callId` of the Subagent tool part the user most
 * recently clicked — the panel scrolls/highlights it. `undefined` means
 * the panel renders the full list without focus.
 */
interface TaskPanelState {
	panelOpen: boolean
	panelWidth: number
	focusedTaskId: string | undefined
	setPanelOpen(open: boolean): void
	togglePanel(): void
	setPanelWidth(width: number): void
	focusTask(taskId: string | undefined): void
	openWithFocus(taskId: string): void
}

const DEFAULT_WIDTH = 360

export const useTaskPanelStore = create<TaskPanelState>((set) => ({
	panelOpen: false,
	panelWidth: DEFAULT_WIDTH,
	focusedTaskId: undefined,
	setPanelOpen: (open) => set({ panelOpen: open }),
	togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
	setPanelWidth: (width) => set({ panelWidth: width }),
	focusTask: (taskId) => set({ focusedTaskId: taskId }),
	openWithFocus: (taskId) => set({ panelOpen: true, focusedTaskId: taskId }),
}))

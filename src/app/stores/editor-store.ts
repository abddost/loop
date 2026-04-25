import type { EditorInfo } from "@core/schema/editor"
import { create } from "zustand"
import { apiClient } from "../lib/api-client"

interface EditorState {
	editors: EditorInfo[]
	init(editors: EditorInfo[]): void
	/** Re-fetch the editor list from the server. Runs fresh detection server-side. */
	refresh(): Promise<void>
}

export const useEditorStore = create<EditorState>()((set) => ({
	editors: [],

	init(editors) {
		set({ editors })
	},

	async refresh() {
		try {
			const editors = await apiClient.get<EditorInfo[]>("/editors")
			set({ editors })
		} catch (err) {
			console.error("[editor-store] refresh failed:", err)
		}
	},
}))

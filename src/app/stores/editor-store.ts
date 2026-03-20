import type { EditorInfo } from "@core/schema/editor"
import { create } from "zustand"

interface EditorState {
	editors: EditorInfo[]
	init(editors: EditorInfo[]): void
}

export const useEditorStore = create<EditorState>()((set) => ({
	editors: [],

	init(editors) {
		set({ editors })
	},
}))

import { useConfigStore } from "../stores/config-store"
import { useEditorStore } from "../stores/editor-store"
import { apiClient } from "./api-client"

/**
 * Resolve the effective default editor.
 * Falls back to the first available non-Finder editor, then Finder.
 */
export function getDefaultEditor(): string | null {
	const { defaultEditor } = useConfigStore.getState().config
	if (defaultEditor) return defaultEditor

	const editors = useEditorStore.getState().editors
	const first = editors.find((e) => e.available && e.id !== "finder")
	return first?.id ?? (editors.some((e) => e.id === "finder") ? "finder" : null)
}

/** Open a file in the user's preferred editor. */
export async function openFile(path: string, line?: number): Promise<void> {
	const editorId = getDefaultEditor()
	if (!editorId) return

	try {
		await apiClient.post("/editor/open", { editorId, path, line })
	} catch (err) {
		console.error("[editor:open]", err)
	}
}

/** Open the workspace directory in a specific editor. */
export async function openDirectoryInEditor(editorId: string): Promise<void> {
	try {
		await apiClient.post("/editor/open", { editorId, directory: true })
	} catch (err) {
		console.error("[editor:open-directory]", err)
	}
}

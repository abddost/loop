import { useParams } from "@tanstack/react-router"
import { useEffect } from "react"
import { bootstrapWorkspace } from "../../bootstrap"
import { FilePanel } from "../../components/file-panel/file-panel"
import { useFilePanelStore } from "../../stores/file-panel-store"

/**
 * Full-screen file panel for popout windows.
 * Bootstraps the workspace and opens the panel automatically.
 */
export function FilePanelPopoutPage() {
	const { dir } = useParams({ strict: false })

	useEffect(() => {
		if (!dir) return
		const directory = decodeURIComponent(dir)
		const store = useFilePanelStore.getState()
		store.switchWorkspace(directory)

		// Ensure panel is open in popout
		if (!store.panelOpen) {
			store.togglePanel()
		}

		bootstrapWorkspace(directory).catch((err) =>
			console.error("[file-panel-popout:bootstrap]", err),
		)
	}, [dir])

	return (
		<div data-shell className="flex h-screen w-screen overflow-hidden bg-background">
			<main className="flex h-full w-full flex-col">
				<FilePanel />
			</main>
		</div>
	)
}

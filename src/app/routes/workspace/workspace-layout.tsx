import { Outlet, useParams } from "@tanstack/react-router"
import { useEffect } from "react"
import { bootstrapWorkspace } from "../../bootstrap"
import { TerminalPanel } from "../../components/terminal/terminal-panel"
import { useRegisterCommand } from "../../hooks/use-keybinding"
import { isPopoutWindow } from "../../lib/popout"
import { useFilePanelStore } from "../../stores/file-panel-store"
import { useTerminalStore } from "../../stores/terminal-store"
import { useUIStore } from "../../stores/ui-store"

export function WorkspaceLayout() {
	const { dir } = useParams({ strict: false })
	const isPopout = isPopoutWindow()

	useEffect(() => {
		if (!dir) return
		const directory = decodeURIComponent(dir)
		useUIStore.getState().setActiveDirectory(directory)
		bootstrapWorkspace(directory).catch((err) => console.error("[workspace:bootstrap]", err))

		// Sync terminal state with workspace (skip in popout — no terminal panel)
		if (!isPopout) {
			useTerminalStore.getState().switchWorkspace(directory)
			useFilePanelStore.getState().switchWorkspace(directory)
		}
	}, [dir, isPopout])

	// Register keybinding commands (skip in popout — those panels don't exist)
	useRegisterCommand(
		isPopout
			? null
			: {
					id: "terminal.toggle",
					handler: () => useTerminalStore.getState().togglePanel(),
				},
	)
	useRegisterCommand(
		isPopout
			? null
			: {
					id: "filePanel.toggle",
					handler: () => useFilePanelStore.getState().togglePanel(),
				},
	)

	return (
		<div className="flex h-full flex-col">
			<div className="min-h-0 flex-1 overflow-hidden">
				<Outlet />
			</div>
			{!isPopout && <TerminalPanel />}
		</div>
	)
}

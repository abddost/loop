import { Outlet, useParams } from "@tanstack/react-router"
import { useEffect } from "react"
import { bootstrapWorkspace } from "../../bootstrap"
import { TerminalPanel } from "../../components/terminal/terminal-panel"
import { isPopoutWindow } from "../../lib/popout"
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
		}
	}, [dir, isPopout])

	// Keyboard shortcut: Ctrl+` to toggle terminal (main window only)
	useEffect(() => {
		if (isPopout) return
		const handler = (e: KeyboardEvent) => {
			if (e.ctrlKey && e.key === "`") {
				e.preventDefault()
				useTerminalStore.getState().togglePanel()
			}
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [isPopout])

	return (
		<div className="flex h-full flex-col">
			<div className="min-h-0 flex-1 overflow-hidden">
				<Outlet />
			</div>
			{!isPopout && <TerminalPanel />}
		</div>
	)
}

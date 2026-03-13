import { Outlet, useParams } from "@tanstack/react-router"
import { useEffect } from "react"
import { bootstrapWorkspace } from "../../bootstrap"
import { useUIStore } from "../../stores/ui-store"

/**
 * Workspace layout: sets up the active directory and bootstraps workspace data.
 * Renders child routes (session views) via Outlet.
 */
export function WorkspaceLayout() {
	const { dir } = useParams({ strict: false })

	useEffect(() => {
		if (!dir) return
		const directory = decodeURIComponent(dir)
		useUIStore.getState().setActiveDirectory(directory)
		bootstrapWorkspace(directory).catch((err) => console.error("[workspace:bootstrap]", err))
	}, [dir])

	return <Outlet />
}

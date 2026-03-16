import { useNavigate } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import { apiClient } from "../lib/api-client"
import type { Project } from "../stores/project-store"
import { useProjectStore } from "../stores/project-store"
import { useUIStore } from "../stores/ui-store"
import { workspaceStoreRegistry } from "../stores/workspace-store"

/**
 * Shared hook for creating a new project via folder picker.
 * Used by the sidebar "+" button and the empty-state CTA.
 */
export function useCreateProject() {
	const navigate = useNavigate()
	const [loading, setLoading] = useState(false)

	const createProject = useCallback(async () => {
		if (loading) return

		let dir: string | null = null
		if (window.desktopBridge?.pickFolder) {
			dir = await window.desktopBridge.pickFolder()
		} else {
			dir = window.prompt("Enter the path to a directory to open as a project:")
		}
		if (!dir) return

		setLoading(true)
		try {
			const project = await apiClient.post<Project>("/projects", { directory: dir })
			useProjectStore.getState().upsertProject(project)
			useUIStore.getState().setActiveProject(project.id)
			useUIStore.getState().setActiveDirectory(dir)
			workspaceStoreRegistry.getOrCreate(dir)
			navigate({
				to: "/workspace/$dir",
				params: { dir: encodeURIComponent(dir) },
			})
		} catch (err) {
			console.error("[project:create]", err)
		} finally {
			setLoading(false)
		}
	}, [loading, navigate])

	return { createProject, loading }
}

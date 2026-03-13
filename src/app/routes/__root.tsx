import type { Project } from "@core/schema"
import { Input, Modal } from "@heroui/react"
import { Outlet, useNavigate } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import { AppShell } from "../components/layout/app-shell"
import { Sidebar } from "../components/layout/sidebar/sidebar"
import { Button } from "../components/ui/button"
import { useAllProjectSessions } from "../hooks/use-all-sessions"
import { apiClient } from "../lib/api-client"
import { useProjectStore } from "../stores/project-store"
import { useUIStore } from "../stores/ui-store"
import { workspaceStoreRegistry } from "../stores/workspace-store"

/**
 * Root layout wrapping all routes with the AppShell and Sidebar.
 */
export function RootLayout() {
	const navigate = useNavigate()
	const projects = useProjectStore((s) => s.projects)
	const activeSessionId = useUIStore((s) => s.activeSessionId)
	const [newProjectOpen, setNewProjectOpen] = useState(false)
	const [newProjectDir, setNewProjectDir] = useState("")
	const [newProjectLoading, setNewProjectLoading] = useState(false)

	// Subscribe to sessions from ALL workspace stores so the sidebar
	// re-renders when any project's sessions change
	const sessionsByProject = useAllProjectSessions()

	const handleSelectSession = useCallback(
		(sessionId: string) => {
			// Find which project owns this session to get the correct directory
			let targetDir: string | null = null
			for (const p of useProjectStore.getState().projects) {
				const store = workspaceStoreRegistry.get(p.directory)
				if (store?.getState().sessions.some((s) => s.id === sessionId)) {
					targetDir = p.directory
					break
				}
			}
			// Fall back to active directory if session not found in any store
			targetDir = targetDir ?? useUIStore.getState().activeDirectory
			if (!targetDir) return

			useUIStore.getState().setActiveDirectory(targetDir)
			useUIStore.getState().setActiveSession(sessionId)
			navigate({
				to: "/workspace/$dir/session/$id",
				params: { dir: encodeURIComponent(targetDir), id: sessionId },
			})
		},
		[navigate],
	)

	const handleNewSession = useCallback(
		(projectId: string) => {
			const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
			if (!project) return
			useUIStore.getState().setActiveProject(projectId)
			useUIStore.getState().setActiveDirectory(project.directory)
			useUIStore.getState().setActiveSession(null)
			navigate({
				to: "/workspace/$dir",
				params: { dir: encodeURIComponent(project.directory) },
			})
		},
		[navigate],
	)

	const handleNewProject = useCallback(() => {
		setNewProjectDir("")
		setNewProjectOpen(true)
	}, [])

	const handleNewProjectSubmit = useCallback(async () => {
		const dir = newProjectDir.trim()
		if (!dir) return
		setNewProjectLoading(true)
		try {
			const project = await apiClient.post<{ id: string; name: string; directory: string }>(
				"/projects",
				{
					directory: dir,
				},
			)
			useProjectStore.getState().addProject(project as any)
			useUIStore.getState().setActiveDirectory(dir)
			workspaceStoreRegistry.getOrCreate(dir)
			setNewProjectOpen(false)
			navigate({
				to: "/workspace/$dir",
				params: { dir: encodeURIComponent(dir) },
			})
		} catch (err) {
			console.error("[project:create]", err)
		} finally {
			setNewProjectLoading(false)
		}
	}, [newProjectDir, navigate])

	const handleOpenSettings = useCallback(() => {
		navigate({ to: "/settings" })
	}, [navigate])

	return (
		<AppShell
			sidebar={
				<Sidebar
					projects={projects as unknown as Project[]}
					sessionsByProject={sessionsByProject as any}
					activeSessionId={activeSessionId ?? undefined}
					onSelectSession={handleSelectSession}
					onNewSession={handleNewSession}
					onNewProject={handleNewProject}
					onOpenSettings={handleOpenSettings}
				/>
			}
		>
			<Outlet />
			<Modal isOpen={newProjectOpen} onOpenChange={(open) => !open && setNewProjectOpen(false)}>
				<Modal.Backdrop>
					<Modal.Container>
						<Modal.Dialog>
							<Modal.CloseTrigger />
							<Modal.Header>
								<Modal.Heading>New Project</Modal.Heading>
							</Modal.Header>
							<Modal.Body>
								<p className="mb-3 text-sm text-muted">
									Enter the path to a directory to open as a project.
								</p>
								<Input
									value={newProjectDir}
									onChange={(e) => setNewProjectDir(e.target.value)}
									placeholder="/path/to/project"
									onKeyDown={(e) => {
										if (e.key === "Enter") handleNewProjectSubmit()
									}}
									autoFocus
								/>
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" size="sm" onClick={() => setNewProjectOpen(false)}>
									Cancel
								</Button>
								<Button
									size="sm"
									onClick={handleNewProjectSubmit}
									disabled={!newProjectDir.trim() || newProjectLoading}
								>
									{newProjectLoading ? "Creating..." : "Create"}
								</Button>
							</Modal.Footer>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</AppShell>
	)
}

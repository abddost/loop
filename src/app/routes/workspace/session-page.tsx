import type { MessageWithParts as CoreMessageWithParts, Project, ProviderInfo } from "@core/schema"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"
import { MessageList } from "../../components/chat/message-list"
import { PermissionDialog } from "../../components/chat/permission-dialog"
import { InputBar } from "../../components/input/input-bar"
import { ProjectSelector } from "../../components/input/project-selector"
import { ContentTitlebar } from "../../components/layout/content-titlebar"
import type { PermissionModeValue } from "../../components/status-bar/permission-mode"
import { StatusBar } from "../../components/status-bar/status-bar"
import { useActiveSession } from "../../hooks/use-session"
import { useWorkspace, useWorkspaceState } from "../../hooks/use-workspace"
import { apiClient } from "../../lib/api-client"
import { useAgentStore } from "../../stores/agent-store"
import { useProjectStore } from "../../stores/project-store"
import { useProviderStore } from "../../stores/provider-store"
import { useUIStore } from "../../stores/ui-store"

/**
 * Unified session page: handles both "new session" mode (no id param)
 * and "existing session" mode (with id param).
 */
export function SessionPage() {
	const { id } = useParams({ strict: false })
	const navigate = useNavigate()
	const { store } = useWorkspace()
	const { session, messages, status } = useActiveSession()
	const projects = useProjectStore((s) => s.projects)
	const activeProjectId = useUIStore((s) => s.activeProjectId)
	const connected = useProviderStore((s) => s.connected)
	const popular = useProviderStore((s) => s.popular)
	const other = useProviderStore((s) => s.other)
	const providers = [...connected, ...popular, ...other]
	const selectedModel = useProviderStore((s) => s.selectedModel)
	const agents = useAgentStore((s) => s.agents)
	const selectedAgent = useAgentStore((s) => s.selectedAgent)

	const pendingPermissions = useWorkspaceState(useCallback((s) => s.pendingPermissions, []))
	const vcsBranch = useWorkspaceState(useCallback((s) => s.vcsBranch, []))
	const permissionMode = useWorkspaceState(useCallback((s) => s.permissionMode, []))

	const [submitting, setSubmitting] = useState(false)

	useEffect(() => {
		if (id) {
			useUIStore.getState().setActiveSession(id)
			store?.getState().setActiveSession(id)
			apiClient
				.get(`/sessions/${id}/messages`)
				.then((msgs) => {
					store?.getState().setMessages(id, msgs as any[])
				})
				.catch((err) => console.error("[session:messages]", err))
		}
	}, [id, store])

	const handleModelSelect = useCallback((modelId: string, providerId: string) => {
		useProviderStore.getState().setSelectedModel(providerId, modelId)
	}, [])

	const handleAgentSelect = useCallback((agentName: string) => {
		useAgentStore.getState().setSelectedAgent(agentName)
	}, [])

	const handlePermissionModeChange = useCallback(
		(mode: PermissionModeValue) => {
			store?.getState().setPermissionMode(mode)
		},
		[store],
	)

	const handlePermissionAllow = useCallback(
		(callId: string) => {
			apiClient
				.post(`/permissions/${callId}`, { action: "allow" })
				.then(() => store?.getState().resolvePermission(callId))
				.catch((err) => console.error("[permission:allow]", err))
		},
		[store],
	)

	const handlePermissionAllowAlways = useCallback(
		(callId: string) => {
			apiClient
				.post(`/permissions/${callId}`, { action: "allow_always" })
				.then(() => store?.getState().resolvePermission(callId))
				.catch((err) => console.error("[permission:allow_always]", err))
		},
		[store],
	)

	const handlePermissionDeny = useCallback(
		(callId: string) => {
			apiClient
				.post(`/permissions/${callId}`, { action: "deny" })
				.then(() => store?.getState().resolvePermission(callId))
				.catch((err) => console.error("[permission:deny]", err))
		},
		[store],
	)

	const handleNewSessionSubmit = useCallback(
		async (text: string) => {
			if (submitting) return
			setSubmitting(true)
			try {
				const newSession = await apiClient.post<{
					id: string
					title: string | null
					directory: string
					createdAt: number
					updatedAt: number
				}>("/sessions", {})

				store?.getState().addSession(newSession as any)
				store?.getState().setActiveSession(newSession.id)
				useUIStore.getState().setActiveSession(newSession.id)

				const dir = useUIStore.getState().activeDirectory!
				navigate({
					to: "/workspace/$dir/session/$id",
					params: { dir: encodeURIComponent(dir), id: newSession.id },
					replace: true,
				})

				apiClient
					.post(`/sessions/${newSession.id}/prompt`, {
						text,
						model: selectedModel ?? undefined,
						agent: selectedAgent,
					})
					.catch((err) => console.error("[session:prompt]", err))
			} catch (err) {
				console.error("[session:create]", err)
			} finally {
				setSubmitting(false)
			}
		},
		[store, navigate, selectedModel, selectedAgent, submitting],
	)

	const handleExistingSessionSubmit = useCallback(
		(text: string) => {
			if (!id) return
			apiClient
				.post(`/sessions/${id}/prompt`, {
					text,
					model: selectedModel ?? undefined,
					agent: selectedAgent,
				})
				.catch((err) => console.error("[session:prompt]", err))
		},
		[id, selectedModel, selectedAgent],
	)

	const handleProjectChange = useCallback(
		(projectId: string) => {
			const project = projects.find((p) => p.id === projectId)
			if (!project) return
			useUIStore.getState().setActiveProject(projectId)
			useUIStore.getState().setActiveDirectory(project.directory)
			navigate({
				to: "/workspace/$dir",
				params: { dir: encodeURIComponent(project.directory) },
				replace: true,
			})
		},
		[projects, navigate],
	)

	const isStreaming = status === "busy"
	const activeProject = projects.find((p) => p.id === activeProjectId)

	// --- NEW SESSION MODE ---
	if (!id) {
		return (
			<div className="flex h-full flex-col">
				<ContentTitlebar projectName={activeProject?.name} />
				<div className="flex flex-1 items-center justify-center">
					<div className="text-center">
						<h1 className="text-2xl font-semibold text-foreground">Let's build</h1>
						<ProjectSelector
							projects={projects as unknown as Project[]}
							selectedProjectId={activeProjectId}
							onSelect={handleProjectChange}
						/>
					</div>
				</div>
				<InputBar
					providers={providers as unknown as ProviderInfo[]}
					selectedProviderId={selectedModel?.providerId}
					selectedModelId={selectedModel?.modelId}
					agents={agents}
					selectedAgentName={selectedAgent}
					onSubmit={handleNewSessionSubmit}
					onModelSelect={handleModelSelect}
					onAgentSelect={handleAgentSelect}
					disabled={submitting}
					placeholder="Send a message to start a new session..."
				/>
				<StatusBar
					permissionMode={(permissionMode ?? "default") as PermissionModeValue}
					onPermissionModeChange={handlePermissionModeChange}
					branch={vcsBranch?.branch}
				/>
			</div>
		)
	}

	// --- LOADING ---
	if (!session) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-muted">Loading session...</p>
			</div>
		)
	}

	const sessionPermissions = (pendingPermissions ?? []).filter((p) => p.sessionId === id)

	return (
		<div className="flex h-full flex-col">
			<ContentTitlebar
				sessionTitle={session.title ?? undefined}
				projectName={activeProject?.name}
				isStreaming={isStreaming}
			/>
			<MessageList
				messages={messages as unknown as CoreMessageWithParts[]}
				isStreaming={isStreaming}
				className="flex-1"
			/>
			{sessionPermissions.map((req) => (
				<PermissionDialog
					key={req.id}
					request={req}
					onAllow={() => handlePermissionAllow(req.id)}
					onAllowAlways={() => handlePermissionAllowAlways(req.id)}
					onDeny={() => handlePermissionDeny(req.id)}
					className="mx-4 mb-2"
				/>
			))}
			<InputBar
				providers={providers as unknown as ProviderInfo[]}
				selectedProviderId={selectedModel?.providerId}
				selectedModelId={selectedModel?.modelId}
				agents={agents}
				selectedAgentName={selectedAgent}
				onSubmit={handleExistingSessionSubmit}
				onModelSelect={handleModelSelect}
				onAgentSelect={handleAgentSelect}
				disabled={isStreaming}
			/>
			<StatusBar
				permissionMode={(permissionMode ?? "default") as PermissionModeValue}
				onPermissionModeChange={handlePermissionModeChange}
				branch={vcsBranch?.branch}
			/>
		</div>
	)
}

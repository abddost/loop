import type { ProviderInfo } from "@core/schema"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"
import type { PermissionModeValue } from "../components/status-bar/permission-mode"
import { apiClient } from "../lib/api-client"
import { useAgentStore } from "../stores/agent-store"
import { useConfigStore } from "../stores/config-store"
import { useProjectStore } from "../stores/project-store"
import { useProviderStore } from "../stores/provider-store"
import { useUIStore } from "../stores/ui-store"
import { useActiveSession } from "./use-session"
import { useWorkspace, useWorkspaceState } from "./use-workspace"

/**
 * Encapsulates all store subscriptions, side effects, and handlers
 * for the session page. The component becomes a pure render layer.
 */
export function useSessionPage() {
	const { id } = useParams({ strict: false })
	const navigate = useNavigate()
	const { store } = useWorkspace()
	const { session, messages, status } = useActiveSession()

	// ─── Store subscriptions ─────────────────────────────────────
	const projects = useProjectStore((s) => s.projects)
	const activeProjectId = useUIStore((s) => s.activeProjectId)
	const selectedModel = useProviderStore((s) => s.selectedModel)
	const agents = useAgentStore((s) => s.agents)
	const selectedAgent = useAgentStore((s) => s.selectedAgent)
	const pendingPermissions = useWorkspaceState(useCallback((s) => s.pendingPermissions, []))
	const vcsBranch = useWorkspaceState(useCallback((s) => s.vcsBranch, []))
	const permissionMode = useWorkspaceState(useCallback((s) => s.permissionMode, []))

	const connected = useProviderStore((s) => s.connected)
	const popular = useProviderStore((s) => s.popular)
	const other = useProviderStore((s) => s.other)
	const providers = [...connected, ...popular, ...other] as unknown as ProviderInfo[]

	// ─── Local state ─────────────────────────────────────────────
	const [submitting, setSubmitting] = useState(false)

	// ─── Derived state ───────────────────────────────────────────
	const isNewSession = !id
	const isStreaming = status === "busy"
	const activeProject = projects.find((p) => p.id === activeProjectId)
	const sessionPermissions = (pendingPermissions ?? []).filter((p) => p.sessionId === id)

	// ─── Effects ─────────────────────────────────────────────────
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

	// ─── Handlers ────────────────────────────────────────────────

	const handleSubmit = useCallback(
		async (text: string) => {
			if (submitting) return
			setSubmitting(true)

			try {
				let sessionId = id
				if (!sessionId) {
					const newSession = await apiClient.post<{
						id: string
						title: string | null
						directory: string
						createdAt: number
						updatedAt: number
					}>("/sessions", {})

					sessionId = newSession.id
					store?.getState().addSession(newSession as any)
					store?.getState().setActiveSession(sessionId)
					useUIStore.getState().setActiveSession(sessionId)

					const dir = useUIStore.getState().activeDirectory!
					navigate({
						to: "/workspace/$dir/session/$id",
						params: { dir: encodeURIComponent(dir), id: sessionId },
						replace: true,
					})
				}

				const optimisticId = `optimistic-${Date.now()}`
				store?.getState().addMessage(sessionId, {
					id: optimisticId,
					sessionId,
					role: "user",
					parts: [{ id: `${optimisticId}-p`, type: "text", text }],
					createdAt: Date.now(),
				})

				apiClient
					.post(`/sessions/${sessionId}/prompt`, {
						text,
						model: selectedModel ?? undefined,
						agent: selectedAgent,
					})
					.catch((err) => console.error("[session:prompt]", err))
			} catch (err) {
				console.error("[session:submit]", err)
			} finally {
				setSubmitting(false)
			}
		},
		[id, store, navigate, selectedModel, selectedAgent, submitting],
	)

	const handleInterrupt = useCallback(() => {
		if (!id) return
		apiClient
			.post(`/sessions/${id}/interrupt`, {})
			.catch((err) => console.error("[session:interrupt]", err))
	}, [id])

	const handleModelSelect = useCallback((modelId: string, providerId: string) => {
		useProviderStore.getState().setSelectedModel(providerId, modelId)
	}, [])

	const handleAgentSelect = useCallback((agentName: string) => {
		useAgentStore.getState().setSelectedAgent(agentName)
	}, [])

	const handlePermissionModeChange = useCallback(
		(mode: PermissionModeValue) => {
			store?.getState().setPermissionMode(mode)
			useConfigStore.getState().update({ permission: { approvalPolicy: mode } })
			if (id) {
				apiClient
					.patch(`/sessions/${id}/permission`, { permissionMode: mode })
					.catch((err) => console.error("[session:permission]", err))
			}
		},
		[store, id],
	)

	const replyPermission = useCallback(
		(callId: string, reply: "once" | "always" | "reject", message?: string) => {
			apiClient
				.post(`/permissions/${callId}`, { reply, message })
				.then(() => store?.getState().resolvePermission(callId))
				.catch((err) => console.error("[permission:reply]", err))
		},
		[store],
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

	return {
		// State
		session,
		messages,
		isNewSession,
		isStreaming,
		submitting,
		activeProject,
		projects,
		activeProjectId,
		sessionPermissions,
		providers,
		selectedModel,
		selectedAgent,
		agents,
		vcsBranch,
		permissionMode,

		// Handlers
		handleSubmit,
		handleInterrupt,
		handleModelSelect,
		handleAgentSelect,
		handlePermissionModeChange,
		replyPermission,
		handleProjectChange,
	}
}

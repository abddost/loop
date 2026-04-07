import { ulid } from "@core/id"
import type { ProviderInfo } from "@core/schema"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useState } from "react"
import { bootstrapWorkspace } from "../bootstrap"
import type { SubmitFiles } from "../components/input/input-bar"
import type { PermissionModeValue } from "../components/status-bar/permission-mode"
import { apiClient } from "../lib/api-client"
import { filterByEnabledModels } from "../lib/model-filter"
import { worktreeApi } from "../lib/worktree-api"
import { worktreeState } from "../lib/worktree-state"
import { useAgentStore } from "../stores/agent-store"
import { useConfigStore } from "../stores/config-store"
import { useProjectStore } from "../stores/project-store"
import { useProviderStore } from "../stores/provider-store"
import { useUIStore } from "../stores/ui-store"
import { workspaceStoreRegistry } from "../stores/workspace-store"
import { useWorktreeStore } from "../stores/worktree-store"
import { useActiveSession } from "./use-session"
import { useWorkspace, useWorkspaceState } from "./use-workspace"

/**
 * Encapsulates all store subscriptions, side effects, and handlers
 * for the session page. The component becomes a pure render layer.
 */
export function useSessionPage() {
	const { id } = useParams({ strict: false })
	const navigate = useNavigate()
	const { directory, store } = useWorkspace()
	const { session, messages, status } = useActiveSession()

	// ─── Store subscriptions ─────────────────────────────────────
	const projects = useProjectStore((s) => s.projects)
	const activeProjectId = useUIStore((s) => s.activeProjectId)
	const selectedModel = useProviderStore((s) => s.selectedModel)
	const reasoningEffort = useProviderStore((s) => s.reasoningEffort)
	const agents = useAgentStore((s) => s.agents)
	const selectedAgent = useAgentStore((s) => s.selectedAgent)
	const pendingPermissions = useWorkspaceState(useCallback((s) => s.pendingPermissions, []))
	const pendingQuestions = useWorkspaceState(useCallback((s) => s.pendingQuestions, []))
	const sessionUsage = useWorkspaceState(
		useCallback((s) => (id ? s.sessionUsage.get(id) : undefined), [id]),
	)
	const vcsBranch = useWorkspaceState(useCallback((s) => s.vcsBranch, []))
	const permissionMode = useWorkspaceState(useCallback((s) => s.permissionMode, []))

	const enabledModels = useConfigStore(useCallback((s) => s.config.enabledModels, []))
	const connected = useProviderStore((s) => s.connected)
	const popular = useProviderStore((s) => s.popular)
	const other = useProviderStore((s) => s.other)
	const allProviders = useMemo(
		() => [...connected, ...popular, ...other] as unknown as ProviderInfo[],
		[connected, popular, other],
	)
	const providers = useMemo(
		() => filterByEnabledModels(allProviders, enabledModels),
		[allProviders, enabledModels],
	)

	const supportsReasoning = useMemo(() => {
		if (!selectedModel) return false
		const model = useProviderStore
			.getState()
			.getModel(selectedModel.providerId, selectedModel.modelId)
		return model?.supportsReasoning ?? false
	}, [selectedModel])

	// ─── Local state ─────────────────────────────────────────────
	const [submitting, setSubmitting] = useState(false)
	const [closing, setClosing] = useState(false)

	// ─── Derived state ───────────────────────────────────────────
	const isNewSession = !id
	const isStreaming = status === "busy" || status === "compacting"
	const isCompacting = status === "compacting"
	const activeProject = projects.find((p) => p.id === activeProjectId)
	const sessionPermissions = (pendingPermissions ?? []).filter((p) => p.sessionId === id)
	// Filter questions for the active session, only "question" tool (plan questions handled inline)
	const sessionQuestions = (pendingQuestions ?? []).filter(
		(q) => q.sessionId === id && q.tool === "question",
	)

	// ─── Effects ─────────────────────────────────────────────────
	useEffect(() => {
		if (id) {
			useUIStore.getState().setActiveSession(id)
			// Only update if different — avoids redundant set() after handleSubmit's initNewSession.
			if (store?.getState().activeSessionId !== id) {
				store?.getState().setActiveSession(id)
			}
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
		async (text: string, files?: SubmitFiles[]) => {
			if (submitting) return
			setSubmitting(true)

			try {
				let targetDirectory = directory
				let targetStore = store
				const worktreeTarget = useWorktreeStore.getState().newSessionWorktree

				// ─── Worktree selection ──────────────────────────────────
				if (!id && worktreeTarget === "create" && targetDirectory) {
					// Create a new worktree
					const sandbox = await worktreeApi.create(targetDirectory)
					targetDirectory = sandbox.directory
					worktreeState.pending(targetDirectory)
					useWorktreeStore.getState().setBusy(targetDirectory, true)
					useWorktreeStore.getState().addWorktree({
						id: sandbox.id,
						directory: sandbox.directory,
						parentDirectory: directory!,
						name: sandbox.name,
						branch: sandbox.branch,
						status: "creating",
						createdAt: Date.now(),
					})
				} else if (!id && worktreeTarget && worktreeTarget !== "main") {
					// Use an existing worktree
					targetDirectory = worktreeTarget
				}

				// Bootstrap target workspace if different from current
				if (targetDirectory && targetDirectory !== directory) {
					await bootstrapWorkspace(targetDirectory)
					targetStore = workspaceStoreRegistry.getOrCreate(targetDirectory)
				}

				let sessionId = id
				if (!sessionId) {
					setClosing(true)

					const currentPermissionMode = (targetStore ?? store)?.getState().permissionMode
					const [newSession] = await Promise.all([
						apiClient.post<{
							id: string
							title: string | null
							directory: string
							createdAt: number
							updatedAt: number
						}>(
							"/sessions",
							{
								permissionMode:
									currentPermissionMode && currentPermissionMode !== "default"
										? currentPermissionMode
										: undefined,
							},
							targetDirectory ? { directory: targetDirectory } : undefined,
						),
						new Promise<void>((r) => setTimeout(r, 400)),
					])

					sessionId = newSession.id
					;(targetStore ?? store)?.getState().initNewSession(newSession as any)

					// Navigate to the correct workspace/session
					const navDir = targetDirectory ?? useUIStore.getState().activeDirectory!
					if (targetDirectory && targetDirectory !== directory) {
						useUIStore.getState().setActiveDirectory(targetDirectory)
					}
					useUIStore.getState().setActiveSession(sessionId)

					navigate({
						to: "/workspace/$dir/session/$id",
						params: { dir: encodeURIComponent(navDir), id: sessionId },
						replace: true,
					})
				}

				const activeStore = targetStore ?? store

				const messageId = ulid()
				const parts: Array<{ id: string; type: string; [key: string]: unknown }> = []

				if (text) {
					parts.push({ id: `${messageId}-p`, type: "text", text })
				}
				if (files) {
					for (let i = 0; i < files.length; i++) {
						const f = files[i]
						parts.push({
							id: `${messageId}-f${i}`,
							type: "file",
							path: f.path,
							mimeType: f.mimeType,
							content: f.content,
						})
					}
				}

				activeStore?.getState().addMessage(sessionId, {
					id: messageId,
					sessionId,
					role: "user",
					parts,
					createdAt: Date.now(),
				})

				// Optimistically set status to "busy" so the stop button appears
				// immediately. The real SSE session:status event is a no-op (same value).
				activeStore?.getState().setSessionStatus(sessionId, "busy")

				// Wait for worktree if we created one
				if (worktreeTarget === "create" && targetDirectory && targetDirectory !== directory) {
					const WORKTREE_TIMEOUT_MS = 5 * 60 * 1000
					const result = await Promise.race([
						worktreeState.wait(targetDirectory),
						new Promise<"timeout">((_, reject) =>
							setTimeout(
								() => reject(new Error("Worktree creation timed out after 5 minutes")),
								WORKTREE_TIMEOUT_MS,
							),
						),
					])
					if (result === "failed") {
						activeStore?.getState().removeMessage(sessionId, messageId)
						activeStore?.getState().setSessionStatus(sessionId, "idle")
						throw new Error("Worktree creation failed")
					}
				}

				const promptDir = targetDirectory ?? undefined
				apiClient
					.post(
						`/sessions/${sessionId}/prompt`,
						{
							messageId,
							text: text || undefined,
							files: files && files.length > 0 ? files : undefined,
							model: selectedModel ?? undefined,
							agent: selectedAgent,
							reasoningEffort: supportsReasoning ? reasoningEffort : undefined,
						},
						promptDir ? { directory: promptDir } : undefined,
					)
					.catch((err) => {
						activeStore?.getState().removeMessage(sessionId, messageId)
						activeStore?.getState().setSessionStatus(sessionId, "idle")
						console.error("[session:prompt]", err)
					})

				// Reset worktree selection after successful submission
				useWorktreeStore.getState().setNewSessionWorktree("main")
			} catch (err) {
				setClosing(false)
				console.error("[session:submit]", err)
			} finally {
				setSubmitting(false)
			}
		},
		[
			id,
			directory,
			store,
			navigate,
			selectedModel,
			selectedAgent,
			submitting,
			supportsReasoning,
			reasoningEffort,
		],
	)

	const handleInterrupt = useCallback(() => {
		if (!id) return
		// Optimistic: set idle immediately so the UI updates before the server responds.
		// The server's SSE session:status "idle" event is idempotent (same value).
		store?.getState().setSessionStatus(id, "idle")
		apiClient
			.post(`/sessions/${id}/cancel`, {})
			.catch((err) => console.error("[session:cancel]", err))
	}, [id, store])

	const handleModelSelect = useCallback((modelId: string, providerId: string) => {
		useProviderStore.getState().setSelectedModel(providerId, modelId)
		useConfigStore.getState().update({ defaultModel: { providerId, modelId } })
	}, [])

	const handleAgentSelect = useCallback((agentName: string) => {
		useAgentStore.getState().setSelectedAgent(agentName)
	}, [])

	const handleReasoningEffortChange = useCallback((effort: "low" | "medium" | "high" | "xhigh") => {
		useProviderStore.getState().setReasoningEffort(effort)
		useConfigStore.getState().update({ reasoning: { effort } })
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

	const answerQuestion = useCallback(
		(questionId: string, answers: string[]) => {
			apiClient
				.post(`/questions/${questionId}`, { answers })
				.then(() => store?.getState().resolveQuestion(questionId))
				.catch((err) => console.error("[question:answer]", err))
		},
		[store],
	)

	const rejectQuestion = useCallback(
		(questionId: string) => {
			apiClient
				.post(`/questions/${questionId}/reject`, {})
				.then(() => store?.getState().resolveQuestion(questionId))
				.catch((err) => console.error("[question:reject]", err))
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
		sessionId: id,
		directory,
		session,
		messages,
		isNewSession,
		isStreaming,
		isCompacting,
		submitting,
		closing,
		activeProject,
		projects,
		activeProjectId,
		sessionPermissions,
		sessionQuestions,
		providers,
		selectedModel,
		selectedAgent,
		agents,
		vcsBranch,
		permissionMode,
		sessionUsage,
		supportsReasoning,
		reasoningEffort,

		// Handlers
		handleSubmit,
		handleInterrupt,
		handleModelSelect,
		handleAgentSelect,
		handleReasoningEffortChange,
		handlePermissionModeChange,
		replyPermission,
		answerQuestion,
		rejectQuestion,
		handleProjectChange,
	}
}

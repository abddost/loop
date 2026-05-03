import { ulid } from "@core/id"
import type { ReasoningEffort } from "@core/schema/config"
import type { AssistantMessageMeta, MessageWithParts } from "@core/schema/message"
import type { ProviderInfo } from "@core/schema/provider"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useState } from "react"
import { bootstrapWorkspace } from "../bootstrap"
import type { SubmitFiles } from "../components/input/input-bar"
import type { PermissionModeValue } from "../components/status-bar/permission-mode"
import { apiClient } from "../lib/api-client"
import { commitDraft, getDraft } from "../lib/draft-session"
import { filterByEnabledModels } from "../lib/model-filter"
import { SessionNotFoundError, ensureSession } from "../lib/session-loader"
import { worktreeApi } from "../lib/worktree-api"
import { worktreeState } from "../lib/worktree-state"
import { useAgentStore } from "../stores/agent-store"
import { useConfigStore } from "../stores/config-store"
import { useProjectStore } from "../stores/project-store"
import { useProviderStore } from "../stores/provider-store"
import { useSnackbarStore } from "../stores/snackbar-store"
import { useUIStore } from "../stores/ui-store"
import { workspaceStoreRegistry } from "../stores/workspace-store"
import type { SessionUsage } from "../stores/workspace-store"
import { useWorktreeStore } from "../stores/worktree-store"
import { useActiveSession } from "./use-session"
import { useWorkspace, useWorkspaceState } from "./use-workspace"

/**
 * Extract SessionUsage from the most recent assistant message that carries
 * token metadata. Used to hydrate the usage ring on session load, since the
 * live `session:usage` SSE event doesn't replay. Returns undefined if no
 * assistant message has been persisted with tokens yet.
 */
function deriveSessionUsage(messages: MessageWithParts[]): SessionUsage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role !== "assistant") continue
		const meta = msg.metadata as AssistantMessageMeta | undefined
		if (!meta?.tokens) continue
		return {
			input: meta.tokens.input,
			output: meta.tokens.output,
			reasoning: meta.tokens.reasoning,
			cacheRead: meta.tokens.cacheRead,
			cacheWrite: meta.tokens.cacheWrite,
			cost: meta.cost ?? 0,
			contextWindow: meta.contextWindow ?? 0,
		}
	}
	return undefined
}

/**
 * Encapsulates all store subscriptions, side effects, and handlers
 * for the session page. The component becomes a pure render layer.
 */
export function useSessionPage() {
	const { id } = useParams({ strict: false })
	const navigate = useNavigate()
	const { directory, store } = useWorkspace()
	const { session, messages, status } = useActiveSession(id ?? null)

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
	const sessionError = useWorkspaceState(
		useCallback((s) => (id ? s.sessionErrors.get(id) : undefined), [id]),
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

	const selectedModelInfo = useMemo(() => {
		if (!selectedModel) return undefined
		return useProviderStore.getState().getModel(selectedModel.providerId, selectedModel.modelId)
	}, [selectedModel])

	const supportsReasoning = useMemo(
		() => selectedModelInfo?.supportsReasoning ?? false,
		[selectedModelInfo],
	)

	/** Whether the model has configurable effort levels (Claude Code or AI SDK reasoning). */
	const hasEffortLevels = useMemo(() => {
		if (!selectedModelInfo) return false
		return (
			(selectedModelInfo.effortLevels && selectedModelInfo.effortLevels.length > 0) ||
			selectedModelInfo.supportsReasoning
		)
	}, [selectedModelInfo])

	/** Whether the selected model is a Claude Code model. */
	const isClaudeCode = selectedModel?.providerId === "claude-code"

	/**
	 * Lock the model picker to a single provider once a session has committed
	 * to a runtime that can't be mixed with the AI-SDK loop. Today that's only
	 * Claude Code CLI: `dispatch.ts` routes based on the last user message's
	 * `metadata.model.providerId`, so we mirror that logic here. Cursor and
	 * everything else share the AI-SDK streaming path and need no lock.
	 *
	 * Returns undefined for new sessions (no messages yet) so the first turn
	 * can still pick any provider.
	 */
	const lockedProviderId = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			if (msg.role !== "user") continue
			const meta = msg.metadata as { model?: { modelId: string; providerId: string } } | undefined
			const pid = meta?.model?.providerId
			return pid === "claude-code" ? pid : undefined
		}
		return undefined
	}, [messages])

	// ─── Local state ─────────────────────────────────────────────
	const [submitting, setSubmitting] = useState(false)
	const [closing, setClosing] = useState(false)

	// ─── Derived state ───────────────────────────────────────────
	// "New session" UI is shown when:
	//   - the URL has no session id (legacy `/workspace/$dir` route), OR
	//   - the URL points at a client-side draft (ULID generated locally,
	//     not yet POSTed). Once the draft commits on first message,
	//     `getDraft(id)` returns undefined and we transition to chat UI.
	// Recomputed every render — `getDraft` is a single localStorage read +
	// JSON.parse, cheap, and we need the fresh value after `commitDraft` so
	// the optimistic-message render flips us into chat UI.
	const isNewSession = !id || !!getDraft(id)
	const isStreaming = status === "busy" || status === "compacting"
	const isCompacting = status === "compacting"
	const activeProject = projects.find((p) => p.id === activeProjectId)
	const sessionPermissions = (pendingPermissions ?? []).filter((p) => p.sessionId === id)
	// Filter questions for the active session, only "question" tool (plan questions handled inline)
	const sessionQuestions = (pendingQuestions ?? []).filter(
		(q) => q.sessionId === id && q.tool === "question",
	)

	// ─── Effects ─────────────────────────────────────────────────

	// Reset the new-session exit animation on every navigation. SessionPage is
	// reused across `/workspace/$dir/session/$id` ↔ `/workspace/$dir` and across
	// draft↔chat transitions; without this reset, a `closing=true` left over
	// from a prior submission would render the next welcome view at opacity 0.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `id` is the trigger — the body intentionally doesn't read it.
	useEffect(() => {
		setClosing(false)
	}, [id])

	useEffect(() => {
		if (!id) {
			// New session: clear workspace store's active session so no stale
			// session bleeds into subsequent navigation or SSE routing.
			store?.getState().setActiveSession(null)
			const approvalPolicy = useConfigStore.getState().config.permission.approvalPolicy
			store?.getState().setPermissionMode(approvalPolicy ?? "default")
			return
		}

		// Set active session BEFORE awaiting the loader. `useSSERouter`
		// (use-sse.ts:101-111) drops events whose sessionId doesn't match
		// activeSessionId / messages.has / childSessionIds; if we awaited
		// ensureSession first, any session:status / message:create event for
		// this session arriving in the gap would be lost.
		useUIStore.getState().setActiveSession(id)
		if (store && store.getState().activeSessionId !== id) {
			store.getState().setActiveSession(id)
		}

		// Draft fast-path: a brand-new client-side session whose ULID is in the
		// URL but hasn't been POSTed yet. No fetch needed — the draft fallback
		// in `useActiveSession` already synthesizes a Session-shaped object,
		// and `handleSubmit` will commit it on first message.
		if (getDraft(id)) {
			const sessionData = store?.getState().sessions.find((s) => s.id === id)
			if (sessionData?.permissionMode) {
				store?.getState().setPermissionMode(sessionData.permissionMode)
			}
			return
		}

		// Sync persisted permission mode from cache immediately if available, so
		// the status bar doesn't flash "default" while the loader runs.
		const cached = store?.getState().sessions.find((s) => s.id === id)
		if (cached?.permissionMode) {
			store?.getState().setPermissionMode(cached.permissionMode)
		}

		if (!directory || !store) return

		const controller = new AbortController()
		ensureSession(store, id, directory, { signal: controller.signal })
			.then(() => {
				if (controller.signal.aborted) return
				const session = store.getState().sessions.find((s) => s.id === id)
				if (session?.permissionMode) {
					store.getState().setPermissionMode(session.permissionMode)
				}
				// Re-derive usage from the last assistant message that carries
				// tokens in its metadata. Without this, UsageBar would show
				// nothing after an app reload — the `session:usage` SSE event
				// is only fired during a live turn.
				const messages = (store.getState().messages.get(id) ?? []) as MessageWithParts[]
				const usage = deriveSessionUsage(messages)
				if (usage) store.getState().setSessionUsage(id, usage)
			})
			.catch((err) => {
				if (controller.signal.aborted) return
				if (err instanceof DOMException && err.name === "AbortError") return
				if (err instanceof SessionNotFoundError) {
					// Session truly doesn't exist (or is archived). Silently redirect
					// to the new-session view — no error UI per design.
					navigate({
						to: "/workspace/$dir",
						params: { dir: encodeURIComponent(directory) },
						replace: true,
					})
					return
				}
				console.error("[session:load]", err)
			})

		return () => controller.abort()
	}, [id, directory, store, navigate])

	// ─── Handlers ────────────────────────────────────────────────

	const handleSubmit = useCallback(
		async (text: string, files?: SubmitFiles[]) => {
			if (submitting) return
			setSubmitting(true)

			// Clear any previous-turn error when starting a new turn.
			// The banner is per-turn, not persistent — it would be misleading
			// to keep showing it once the user has acted on the failure.
			if (id) store?.getState().clearSessionError(id)

			try {
				let targetDirectory = directory
				// `store` from `useWorkspace()` returns null when the registry hasn't
				// yet created an entry for `directory` (e.g. just-mounted workspace
				// whose bootstrap is racing). Always resolve via `getOrCreate` so the
				// rest of handleSubmit operates on a real store — otherwise `upsertSession`
				// silently no-ops and the UI sticks on "Loading session...".
				let targetStore =
					store ?? (directory ? workspaceStoreRegistry.getOrCreate(directory) : null)
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
				} else if (
					!id &&
					worktreeTarget &&
					worktreeTarget !== "main" &&
					worktreeTarget !== "cursor"
				) {
					// Use an existing worktree. The "cursor" sentinel is a UI
					// indicator only — backend dispatch already routes by
					// model.providerId — so it stays on the main directory.
					targetDirectory = worktreeTarget
				}

				// Bootstrap target workspace if different from current
				if (targetDirectory && targetDirectory !== directory) {
					await bootstrapWorkspace(targetDirectory)
					targetStore = workspaceStoreRegistry.getOrCreate(targetDirectory)
				}

				let sessionId = id
				// A draft is a client-generated ULID already in the URL whose row
				// hasn't been POSTed to the server yet. The first message commits
				// the draft via an idempotent POST /sessions with the existing id.
				const draft = sessionId ? getDraft(sessionId) : undefined
				const isDraftCommit = !!draft

				if (!sessionId || isDraftCommit) {
					setClosing(true)

					const currentPermissionMode = (targetStore ?? store)?.getState().permissionMode
					const postBody: { id?: string; permissionMode?: string } = {
						permissionMode:
							currentPermissionMode && currentPermissionMode !== "default"
								? currentPermissionMode
								: undefined,
					}
					if (isDraftCommit && sessionId) postBody.id = sessionId

					const [newSession] = await Promise.all([
						apiClient.post<{
							id: string
							title: string | null
							directory: string
							createdAt: number
							updatedAt: number
						}>("/sessions", postBody, targetDirectory ? { directory: targetDirectory } : undefined),
						// Holds navigation back just long enough for the new-session
						// view's exit animation to play (220ms + small slack). Any
						// longer and a fast network feels like the UI is stalling.
						new Promise<void>((r) => setTimeout(r, 240)),
					])

					sessionId = newSession.id

					if (isDraftCommit) {
						// URL is already at /workspace/$dir/session/$sessionId — no nav.
						// Replace any synthesized draft entry in the store with the
						// authoritative server row.
						;(targetStore ?? store)?.getState().upsertSession(newSession as any)
						commitDraft(sessionId)
						useUIStore.getState().setActiveSession(sessionId)
					} else {
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
				const isClaudeCode = selectedModel?.providerId === "claude-code"
				apiClient
					.post(
						`/sessions/${sessionId}/prompt`,
						{
							messageId,
							text: text || undefined,
							files: files && files.length > 0 ? files : undefined,
							model: selectedModel ?? undefined,
							agent: selectedAgent,
							reasoningEffort: supportsReasoning && !isClaudeCode ? reasoningEffort : undefined,
							effort: isClaudeCode && hasEffortLevels ? reasoningEffort : undefined,
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
			hasEffortLevels,
			reasoningEffort,
		],
	)

	const dismissSessionError = useCallback(() => {
		if (!id) return
		store?.getState().clearSessionError(id)
	}, [id, store])

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

	const handleReasoningEffortChange = useCallback((effort: ReasoningEffort) => {
		useProviderStore.getState().setReasoningEffort(effort)
		useConfigStore.getState().update({ reasoning: { effort } })
	}, [])

	const handlePermissionModeChange = useCallback(
		(mode: PermissionModeValue) => {
			store?.getState().setPermissionMode(mode)
			// Only sync to global config for modes the approval policy supports.
			// Claude-Code-specific modes ("auto-accept-edits", "plan") are
			// session-level only and don't affect the global default.
			if (mode === "default" || mode === "full-access") {
				useConfigStore.getState().update({ permission: { approvalPolicy: mode } })
			}
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
				.catch(() => {
					// Server no longer has this permission pending (stale after reconnect
					// or already resolved). Clean up the client-side dialog gracefully.
					store?.getState().resolvePermission(callId)
				})
		},
		[store],
	)

	const answerQuestion = useCallback(
		(questionId: string, answers: string[]) => {
			apiClient
				.post(`/questions/${questionId}`, { answers })
				.then(() => store?.getState().resolveQuestion(questionId))
				.catch(() => store?.getState().resolveQuestion(questionId))
		},
		[store],
	)

	const rejectQuestion = useCallback(
		(questionId: string) => {
			apiClient
				.post(`/questions/${questionId}/reject`, {})
				.then(() => store?.getState().resolveQuestion(questionId))
				.catch(() => store?.getState().resolveQuestion(questionId))
		},
		[store],
	)

	const handleArchiveSession = useCallback(() => {
		if (!id || !directory) return
		useUIStore.getState().setActiveSession(null)
		store?.getState().removeSession(id)
		navigate({
			to: "/workspace/$dir",
			params: { dir: encodeURIComponent(directory) },
			replace: true,
		})
		apiClient
			.patch(`/sessions/${id}`, { archivedAt: Date.now() }, { directory })
			.catch((err) => console.error("[session:archive]", err))
	}, [id, directory, store, navigate])

	const handleRenameSession = useCallback(
		(newTitle: string) => {
			if (!id || !directory) return
			apiClient
				.patch(`/sessions/${id}`, { title: newTitle }, { directory })
				.catch((err) => console.error("[session:rename]", err))
		},
		[id, directory],
	)

	const handleUndo = useCallback(
		async (hash: string) => {
			if (!id || !directory || !store) return
			const msg = (store.getState().messages.get(id) ?? []).find((m) =>
				m.parts.some((p: any) => p.type === "edit" && p.hash === hash),
			)
			if (!msg) return
			try {
				await apiClient.post(`/sessions/${id}/revert`, { messageId: msg.id }, { directory })
				await apiClient.post(`/sessions/${id}/revert/cleanup`, {}, { directory })
				const refreshedMsgs = await apiClient.get<any[]>(`/sessions/${id}/messages`, { directory })
				store.getState().setMessages(id, refreshedMsgs)
				useSnackbarStore.getState().push("Changes reverted", "success", 2500)
			} catch (err) {
				console.error("[revert]", err)
				useSnackbarStore.getState().push("Revert failed", "error", 3000)
			}
		},
		[id, directory, store],
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
		selectedModelInfo,
		selectedAgent,
		agents,
		vcsBranch,
		permissionMode,
		sessionUsage,
		sessionError,
		supportsReasoning,
		hasEffortLevels,
		reasoningEffort,
		isClaudeCode,
		lockedProviderId,

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
		handleArchiveSession,
		handleRenameSession,
		handleUndo,
		dismissSessionError,
	}
}

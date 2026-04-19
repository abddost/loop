import type { MessageWithParts as CoreMessageWithParts, Project, ProviderInfo } from "@core/schema"
import { useCallback, useMemo, useRef, useState } from "react"
import { MessageList, type MessageListHandle } from "../../components/chat/message-list"
import { PermissionDialog } from "../../components/chat/permission-dialog"
import { PlanApprovalDialog } from "../../components/chat/plan-approval-dialog"
import { QuestionDialog } from "../../components/chat/question-dialog"
import { ThreadErrorBanner } from "../../components/chat/thread-error-banner"
import { type TodoItem, TodoPanel } from "../../components/chat/todo-progress"
import { InputBar } from "../../components/input/input-bar"
import { ProjectSelector } from "../../components/input/project-selector"
import { ContentTitlebar } from "../../components/layout/content-titlebar"
import type { PermissionModeValue } from "../../components/status-bar/permission-mode"
import { StatusBar } from "../../components/status-bar/status-bar"
import { useRegisterCommand } from "../../hooks/use-keybinding"
import { useSessionPage } from "../../hooks/use-session-page"
import { openFile } from "../../lib/editor"
import { usePinStore } from "../../stores/pin-store"
import { useSnackbarStore } from "../../stores/snackbar-store"
import { useWorktreeStore } from "../../stores/worktree-store"

export function SessionPage() {
	const {
		sessionId,
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
		hasEffortLevels,
		reasoningEffort,
		handleSubmit,
		handleInterrupt,
		handleModelSelect,
		handleAgentSelect,
		handleReasoningEffortChange,
		handlePermissionModeChange,
		isClaudeCode,
		sessionError,
		dismissSessionError,
		replyPermission,
		answerQuestion,
		rejectQuestion,
		handleProjectChange,
		handleArchiveSession,
		handleRenameSession,
		handleUndo,
		sessionUsage,
	} = useSessionPage()

	const activeTodos = useMemo(() => {
		if (isNewSession) return undefined
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			for (let j = msg.parts.length - 1; j >= 0; j--) {
				const part = msg.parts[j] as {
					type: string
					tool?: string
					input?: Record<string, unknown>
					metadata?: Record<string, unknown>
				}
				if (
					part.type === "tool" &&
					part.tool?.toLowerCase().replace(/[_\s]/g, "-") === "todowrite"
				) {
					// Prefer metadata.todos (normalized from SDK result) over input.todos.
					const todos = (part.metadata?.todos ?? part.input?.todos) as TodoItem[] | undefined
					if (todos && todos.length > 0) return todos
				}
			}
		}
		return undefined
	}, [messages, isNewSession])

	const [showTodos, setShowTodos] = useState(false)

	// ── Plan detection ───────────────────────────────────────────
	// Walk backwards to find the most recent ExitPlanMode result. We
	// extract both the message index (for scroll-to-plan) and the on-disk
	// path the SDK wrote the plan to (for open-in-editor). The SDK only
	// populates planPath when it succeeds in persisting — we tolerate its
	// absence and disable the open button rather than failing loudly.
	const planLocation = useMemo(() => {
		if (isNewSession) return { index: -1, path: undefined as string | undefined }
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			for (const part of msg.parts) {
				const p = part as { type: string; tool?: string; metadata?: Record<string, unknown> }
				if (
					p.type === "tool" &&
					p.tool?.toLowerCase().replace(/[_\s]/g, "-") === "plan-exit" &&
					p.metadata?.planContent
				) {
					return {
						index: i,
						path: typeof p.metadata.planPath === "string" ? p.metadata.planPath : undefined,
					}
				}
			}
		}
		return { index: -1, path: undefined as string | undefined }
	}, [messages, isNewSession])

	const planMessageIndex = planLocation.index
	const planPath = planLocation.path

	const messageListRef = useRef<MessageListHandle>(null)

	const handleScrollToPlan = useCallback(() => {
		if (planMessageIndex >= 0) {
			messageListRef.current?.scrollToIndex(planMessageIndex)
		}
	}, [planMessageIndex])

	const handleOpenPlanFile = useCallback(() => {
		if (planPath) openFile(planPath)
	}, [planPath])

	// ── Titlebar keybindings ─────────────────────────────────────
	const [renameTrigger, setRenameTrigger] = useState(0)

	useRegisterCommand(
		sessionId
			? {
					id: "session.pin",
					handler: () => usePinStore.getState().togglePin(sessionId),
				}
			: null,
	)
	useRegisterCommand(
		sessionId
			? {
					id: "session.rename",
					handler: () => setRenameTrigger((c) => c + 1),
				}
			: null,
	)
	useRegisterCommand(sessionId ? { id: "session.archive", handler: handleArchiveSession } : null)
	useRegisterCommand(
		sessionId && directory
			? {
					id: "session.copyDirectory",
					handler: () => {
						navigator.clipboard.writeText(directory).then(
							() => useSnackbarStore.getState().push("Directory copied", "success", 2000),
							() => useSnackbarStore.getState().push("Failed to copy", "error", 2000),
						)
					},
				}
			: null,
	)
	useRegisterCommand(
		sessionId
			? {
					id: "session.copyId",
					handler: () => {
						navigator.clipboard.writeText(sessionId).then(
							() => useSnackbarStore.getState().push("Session ID copied", "success", 2000),
							() => useSnackbarStore.getState().push("Failed to copy", "error", 2000),
						)
					},
				}
			: null,
	)

	// Worktree-aware branch: show the selected sandbox's branch instead of the main workspace branch
	const worktreeSelection = useWorktreeStore((s) => s.newSessionWorktree)
	const allWorktrees = useWorktreeStore((s) => s.worktrees)
	const effectiveBranch = useMemo(() => {
		if (!isNewSession) return vcsBranch?.branch
		if (worktreeSelection === "main" || worktreeSelection === "create") return vcsBranch?.branch
		const wt = allWorktrees.get(worktreeSelection)
		return wt?.branch ?? vcsBranch?.branch
	}, [isNewSession, vcsBranch, worktreeSelection, allWorktrees])

	// Existing session still loading from server
	if (!isNewSession && !session) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-muted">Loading session...</p>
			</div>
		)
	}

	return (
		<div className="flex h-full flex-col">
			<ContentTitlebar
				sessionId={sessionId}
				sessionTitle={session?.title ?? undefined}
				projectName={activeProject?.name}
				directory={directory ?? undefined}
				isStreaming={isNewSession ? undefined : isStreaming}
				onRenameSession={handleRenameSession}
				onArchiveSession={handleArchiveSession}
				renameTrigger={renameTrigger}
			/>

			{isNewSession ? (
				<div
					className="relative flex flex-1 items-center justify-center overflow-hidden"
					style={{
						backgroundImage:
							"linear-gradient(var(--app-welcome-grid) 1px, transparent 1px), linear-gradient(90deg, var(--app-welcome-grid) 1px, transparent 1px)",
						backgroundSize: "32px 32px",
						opacity: closing ? 0 : 1,
						transform: closing ? "scale(0.97)" : "scale(1)",
						filter: closing ? "blur(6px)" : "none",
						transition: "opacity 400ms ease, transform 400ms ease, filter 400ms ease",
					}}
				>
					<div className="pointer-events-none absolute inset-0" aria-hidden="true">
						<div
							className="absolute top-1/2 left-1/2 h-[500px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
							style={{
								background:
									"radial-gradient(ellipse at center, var(--app-welcome-glow-1) 0%, transparent 70%)",
							}}
						/>
						<div
							className="absolute top-[45%] left-[40%] h-[400px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
							style={{
								background:
									"radial-gradient(ellipse at center, var(--app-welcome-glow-2) 0%, transparent 70%)",
							}}
						/>
						<div
							className="absolute top-[55%] left-[60%] h-[400px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
							style={{
								background:
									"radial-gradient(ellipse at center, var(--app-welcome-glow-3) 0%, transparent 70%)",
							}}
						/>
					</div>
					<div className="relative text-center">
						<h1 className="text-3xl font-semibold text-foreground">Let's start</h1>
						<ProjectSelector
							projects={projects as unknown as Project[]}
							selectedProjectId={activeProjectId}
							onSelect={handleProjectChange}
						/>
					</div>
				</div>
			) : (
				<>
					{sessionError && (
						<ThreadErrorBanner
							error={sessionError}
							onDismiss={dismissSessionError}
							className="pt-3"
						/>
					)}
					<MessageList
						ref={messageListRef}
						sessionId={sessionId ?? ""}
						messages={messages as unknown as CoreMessageWithParts[]}
						isStreaming={isStreaming}
						isCompacting={isCompacting}
						onUndo={handleUndo}
						className="flex-1"
					/>
					{sessionPermissions.map((req) =>
						req.type === "plan_approval" ? (
							<PlanApprovalDialog
								key={req.id}
								onAccept={() => replyPermission(req.id, "once")}
								onAcceptAllowEdits={() => replyPermission(req.id, "always")}
								onRevise={(msg) => replyPermission(req.id, "reject", msg)}
							/>
						) : (
							<PermissionDialog
								key={req.id}
								request={req}
								onAllow={() => replyPermission(req.id, "once")}
								onAllowAlways={() => replyPermission(req.id, "always")}
								onDeny={() => replyPermission(req.id, "reject")}
							/>
						),
					)}
					{sessionQuestions.map((q) => (
						<QuestionDialog
							key={q.id}
							question={q}
							onAnswer={answerQuestion}
							onReject={rejectQuestion}
						/>
					))}
				</>
			)}

			{activeTodos && <TodoPanel todos={activeTodos} open={showTodos} />}
			<InputBar
				providers={providers as unknown as ProviderInfo[]}
				selectedProviderId={selectedModel?.providerId}
				selectedModelId={selectedModel?.modelId}
				selectedModelInfo={selectedModelInfo}
				agents={agents}
				selectedAgentName={selectedAgent}
				onSubmit={handleSubmit}
				onModelSelect={handleModelSelect}
				onAgentSelect={handleAgentSelect}
				hasEffortLevels={hasEffortLevels}
				reasoningEffort={reasoningEffort}
				onReasoningEffortChange={handleReasoningEffortChange}
				isClaudeCode={isClaudeCode}
				permissionMode={(permissionMode ?? "default") as PermissionModeValue}
				onPermissionModeChange={handlePermissionModeChange}
				sessionUsage={isNewSession ? undefined : sessionUsage}
				isStreaming={isNewSession ? undefined : isStreaming}
				onInterrupt={isNewSession ? undefined : handleInterrupt}
				disabled={isNewSession ? submitting : isStreaming}
				placeholder={isNewSession ? "Send a message to start a new session..." : undefined}
			/>
			<StatusBar
				permissionMode={(permissionMode ?? "default") as PermissionModeValue}
				onPermissionModeChange={handlePermissionModeChange}
				isClaudeCode={isClaudeCode}
				branch={effectiveBranch}
				isNewSession={isNewSession}
				hasGit={activeProject?.vcs === "git"}
				parentDirectory={activeProject?.directory}
				sessionDirectory={directory ?? undefined}
				hasPlan={planMessageIndex >= 0}
				onScrollToPlan={handleScrollToPlan}
				onOpenPlanFile={planPath ? handleOpenPlanFile : undefined}
				hasTodos={!!activeTodos}
				todoDone={activeTodos?.filter((t) => t.status === "done").length}
				todoTotal={activeTodos?.length}
				todosOpen={showTodos}
				onToggleTodos={() => setShowTodos((prev) => !prev)}
			/>
		</div>
	)
}

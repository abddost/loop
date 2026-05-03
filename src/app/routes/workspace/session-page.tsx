import type { MessageWithParts as CoreMessageWithParts, Project, ProviderInfo } from "@core/schema"
import { FolderOpen } from "@openai/apps-sdk-ui/components/Icon"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useMemo, useRef, useState } from "react"
import logoUrl from "../../assets/icons/logo.png"
import { MessageList, type MessageListHandle } from "../../components/chat/message-list"
import { PermissionDialog } from "../../components/chat/permission-dialog"
import { PlanApprovalDialog } from "../../components/chat/plan-approval-dialog"
import { QuestionDialog } from "../../components/chat/question-dialog"
import { ThreadErrorBanner } from "../../components/chat/thread-error-banner"
import { type TodoItem, TodoPanel } from "../../components/chat/todo-progress"
import { InputBar } from "../../components/input/input-bar"
import { ProjectSelector } from "../../components/input/project-selector"
import { ContentTitlebar } from "../../components/layout/content-titlebar"
import {
	PermissionMode,
	type PermissionModeValue,
} from "../../components/status-bar/permission-mode"
import { StatusBar } from "../../components/status-bar/status-bar"
import { VcsStatus } from "../../components/status-bar/vcs-status"
import { WorkspaceMode } from "../../components/status-bar/workspace-mode"
import { useCreateProject } from "../../hooks/use-create-project"
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
		lockedProviderId,
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

	const navigate = useNavigate()
	const handleManageModels = useCallback(() => {
		navigate({ to: "/settings", search: { tab: "models" } })
	}, [navigate])

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
	const { createProject } = useCreateProject()

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

	const sharedInputBarProps = {
		providers: providers as unknown as ProviderInfo[],
		selectedProviderId: selectedModel?.providerId,
		selectedModelId: selectedModel?.modelId,
		selectedModelInfo,
		agents,
		selectedAgentName: selectedAgent,
		onSubmit: handleSubmit,
		onModelSelect: handleModelSelect,
		onManageModels: handleManageModels,
		onAgentSelect: handleAgentSelect,
		hasEffortLevels,
		reasoningEffort,
		onReasoningEffortChange: handleReasoningEffortChange,
		isClaudeCode,
		lockedProviderId,
		permissionMode: (permissionMode ?? "default") as PermissionModeValue,
		onPermissionModeChange: handlePermissionModeChange,
	}

	return (
		<div className="flex h-full flex-col">
			<ContentTitlebar
				sessionId={sessionId}
				sessionTitle={session?.title ?? undefined}
				projectName={activeProject?.name}
				directory={directory ?? undefined}
				onRenameSession={handleRenameSession}
				onArchiveSession={handleArchiveSession}
				renameTrigger={renameTrigger}
			/>

			{isNewSession ? (
				<div
					className="flex flex-1 flex-col items-center justify-center overflow-hidden [will-change:opacity,transform]"
					style={{
						opacity: closing ? 0 : 1,
						transform: closing ? "scale(0.985)" : "scale(1)",
						transition:
							"opacity 220ms cubic-bezier(0.32, 0.72, 0, 1), transform 220ms cubic-bezier(0.32, 0.72, 0, 1)",
					}}
				>
					{activeProject ? (
						<div className="w-full max-w-[52rem] px-12">
							<h1 className="mb-10 text-center text-4xl font-semibold tracking-el-tight text-foreground">
								{`Let's start building in ${activeProject.name}`}
							</h1>
							<InputBar
								{...sharedInputBarProps}
								disabled={submitting}
								placeholder="Send a message to start a new session..."
								className="max-w-none px-0"
								contextRow={
									<div className="flex items-center justify-between px-3 py-2">
										<div className="flex items-center gap-2">
											<ProjectSelector
												projects={projects as unknown as Project[]}
												selectedProjectId={activeProjectId}
												onSelect={handleProjectChange}
												onNewProject={createProject}
											/>
											{activeProject?.vcs === "git" && activeProject?.directory && (
												<WorkspaceMode parentDirectory={activeProject.directory} isNewSession />
											)}
										</div>
										<div className="flex items-center gap-2">
											{effectiveBranch && <VcsStatus branch={effectiveBranch} />}
											{!isClaudeCode && (
												<PermissionMode
													value={(permissionMode ?? "default") as PermissionModeValue}
													onChange={handlePermissionModeChange}
												/>
											)}
										</div>
									</div>
								}
							/>
						</div>
					) : (
						<div className="flex flex-col items-center text-center">
							<img src={logoUrl} alt="Loop" className="-mb-16 -mt-8 w-72 dark:invert" />
							<p className="mt-2 text-sm text-muted-foreground">Add a project to get started.</p>
							<button
								type="button"
								onClick={createProject}
								className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--app-surface-hover)] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[var(--default)]"
							>
								<FolderOpen className="h-4 w-4" aria-hidden="true" />
								Open Project
							</button>
						</div>
					)}
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col animate-in fade-in duration-200 ease-out">
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
					{sessionPermissions[0] &&
						(sessionPermissions[0].type === "plan_approval" ? (
							<PlanApprovalDialog
								key={sessionPermissions[0].id}
								onAccept={() => replyPermission(sessionPermissions[0].id, "once")}
								onAcceptAllowEdits={() => replyPermission(sessionPermissions[0].id, "always")}
								onRevise={(msg) => replyPermission(sessionPermissions[0].id, "reject", msg)}
							/>
						) : (
							<PermissionDialog
								key={sessionPermissions[0].id}
								request={sessionPermissions[0]}
								onAllow={() => replyPermission(sessionPermissions[0].id, "once")}
								onAllowAlways={() => replyPermission(sessionPermissions[0].id, "always")}
								onDeny={() => replyPermission(sessionPermissions[0].id, "reject")}
							/>
						))}
					{sessionQuestions.map((q) => (
						<QuestionDialog
							key={q.id}
							question={q}
							onAnswer={answerQuestion}
							onReject={rejectQuestion}
						/>
					))}
					{activeTodos && <TodoPanel todos={activeTodos} open={showTodos} />}
					<InputBar
						{...sharedInputBarProps}
						sessionUsage={sessionUsage}
						isStreaming={isStreaming}
						onInterrupt={handleInterrupt}
						disabled={isStreaming}
					/>
					<StatusBar
						permissionMode={(permissionMode ?? "default") as PermissionModeValue}
						onPermissionModeChange={handlePermissionModeChange}
						isClaudeCode={isClaudeCode}
						branch={effectiveBranch}
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
			)}
		</div>
	)
}

import type { MessageWithParts as CoreMessageWithParts, Project, ProviderInfo } from "@core/schema"
import { useCallback, useMemo, useState } from "react"
import { MessageList } from "../../components/chat/message-list"
import { PermissionDialog } from "../../components/chat/permission-dialog"
import { QuestionDialog } from "../../components/chat/question-dialog"
import { type TodoItem, TodoPanel } from "../../components/chat/todo-progress"
import { InputBar } from "../../components/input/input-bar"
import { ProjectSelector } from "../../components/input/project-selector"
import { ContentTitlebar } from "../../components/layout/content-titlebar"
import type { PermissionModeValue } from "../../components/status-bar/permission-mode"
import { StatusBar } from "../../components/status-bar/status-bar"
import { useSessionPage } from "../../hooks/use-session-page"
import { apiClient } from "../../lib/api-client"

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
		selectedAgent,
		agents,
		vcsBranch,
		permissionMode,
		supportsReasoning,
		reasoningEffort,
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
		sessionUsage,
	} = useSessionPage()

	const activeTodos = useMemo(() => {
		if (isNewSession) return undefined
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			for (let j = msg.parts.length - 1; j >= 0; j--) {
				const part = msg.parts[j]
				if (
					part.type === "tool" &&
					part.tool?.toLowerCase().replace(/[_\s]/g, "-") === "todowrite"
				) {
					const todos = part.input?.todos as TodoItem[] | undefined
					if (todos && todos.length > 0) return todos
				}
			}
		}
		return undefined
	}, [messages, isNewSession])

	const [showTodos, setShowTodos] = useState(false)

	const handleUndo = useCallback(
		(hash: string) => {
			if (!sessionId || !directory) return
			// Find the message containing the EditPart with this hash
			const msg = messages.find((m) =>
				m.parts.some((p: any) => p.type === "edit" && p.hash === hash),
			)
			if (!msg) return
			apiClient
				.post(`/sessions/${sessionId}/revert`, { messageId: msg.id }, { directory })
				.catch((err) => console.error("[revert]", err))
		},
		[sessionId, directory, messages],
	)

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
					<MessageList
						messages={messages as unknown as CoreMessageWithParts[]}
						isStreaming={isStreaming}
						isCompacting={isCompacting}
						onUndo={handleUndo}
						className="flex-1"
					/>
					{sessionPermissions.map((req) => (
						<PermissionDialog
							key={req.id}
							request={req}
							onAllow={() => replyPermission(req.id, "once")}
							onAllowAlways={() => replyPermission(req.id, "always")}
							onDeny={() => replyPermission(req.id, "reject")}
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
				</>
			)}

			{activeTodos && <TodoPanel todos={activeTodos} open={showTodos} />}
			<InputBar
				providers={providers as unknown as ProviderInfo[]}
				selectedProviderId={selectedModel?.providerId}
				selectedModelId={selectedModel?.modelId}
				agents={agents}
				selectedAgentName={selectedAgent}
				onSubmit={handleSubmit}
				onModelSelect={handleModelSelect}
				onAgentSelect={handleAgentSelect}
				supportsReasoning={supportsReasoning}
				reasoningEffort={reasoningEffort}
				onReasoningEffortChange={handleReasoningEffortChange}
				sessionUsage={isNewSession ? undefined : sessionUsage}
				isStreaming={isNewSession ? undefined : isStreaming}
				onInterrupt={isNewSession ? undefined : handleInterrupt}
				disabled={isNewSession ? submitting : isStreaming}
				placeholder={isNewSession ? "Send a message to start a new session..." : undefined}
			/>
			<StatusBar
				permissionMode={(permissionMode ?? "default") as PermissionModeValue}
				onPermissionModeChange={handlePermissionModeChange}
				branch={vcsBranch?.branch}
				hasTodos={!!activeTodos}
				todoDone={activeTodos?.filter((t) => t.status === "done").length}
				todoTotal={activeTodos?.length}
				todosOpen={showTodos}
				onToggleTodos={() => setShowTodos((prev) => !prev)}
			/>
		</div>
	)
}

import type { MessageWithParts as CoreMessageWithParts, Project, ProviderInfo } from "@core/schema"
import { MessageList } from "../../components/chat/message-list"
import { PermissionDialog } from "../../components/chat/permission-dialog"
import { InputBar } from "../../components/input/input-bar"
import { ProjectSelector } from "../../components/input/project-selector"
import { ContentTitlebar } from "../../components/layout/content-titlebar"
import type { PermissionModeValue } from "../../components/status-bar/permission-mode"
import { StatusBar } from "../../components/status-bar/status-bar"
import { useSessionPage } from "../../hooks/use-session-page"

export function SessionPage() {
	const {
		sessionId,
		directory,
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
		handleSubmit,
		handleInterrupt,
		handleModelSelect,
		handleAgentSelect,
		handlePermissionModeChange,
		replyPermission,
		handleProjectChange,
	} = useSessionPage()

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
							"linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
						backgroundSize: "32px 32px",
					}}
				>
					<div className="pointer-events-none absolute inset-0" aria-hidden="true">
						<div className="absolute top-1/2 left-1/2 h-[500px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(52,211,153,0.15)_0%,transparent_70%)] blur-3xl" />
						<div className="absolute top-[45%] left-[40%] h-[400px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.12)_0%,transparent_70%)] blur-3xl" />
						<div className="absolute top-[55%] left-[60%] h-[400px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(6,148,120,0.1)_0%,transparent_70%)] blur-3xl" />
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
				</>
			)}

			<InputBar
				providers={providers as unknown as ProviderInfo[]}
				selectedProviderId={selectedModel?.providerId}
				selectedModelId={selectedModel?.modelId}
				agents={agents}
				selectedAgentName={selectedAgent}
				onSubmit={handleSubmit}
				onModelSelect={handleModelSelect}
				onAgentSelect={handleAgentSelect}
				isStreaming={isNewSession ? undefined : isStreaming}
				onInterrupt={isNewSession ? undefined : handleInterrupt}
				disabled={isNewSession ? submitting : isStreaming}
				placeholder={isNewSession ? "Send a message to start a new session..." : undefined}
			/>
			<StatusBar
				permissionMode={(permissionMode ?? "default") as PermissionModeValue}
				onPermissionModeChange={handlePermissionModeChange}
				branch={vcsBranch?.branch}
			/>
		</div>
	)
}

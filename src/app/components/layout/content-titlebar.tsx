import {
	Branch,
	DotsHorizontalMoreMenu,
	PopOutWindow,
	SidebarLeft,
	Terminal,
	X,
} from "@openai/apps-sdk-ui/components/Icon"
import { useCallback } from "react"
import { desktopBridge } from "../../lib/desktop-bridge"
import { isPopoutWindow } from "../../lib/popout"
import { useTerminalStore } from "../../stores/terminal-store"
import { useUIStore } from "../../stores/ui-store"
import { cn } from "../ui/cn"
import { EditorDropdown } from "./editor-dropdown"

export interface ContentTitlebarProps {
	sessionId?: string
	sessionTitle?: string
	projectName?: string
	directory?: string
	isStreaming?: boolean
	className?: string
}

/**
 * Main content area titlebar showing current session info and action buttons.
 * In popout mode, shows close/return-to-main controls instead.
 */
export function ContentTitlebar({
	sessionId,
	sessionTitle,
	projectName,
	directory,
	isStreaming,
	className,
}: ContentTitlebarProps) {
	const isPopout = isPopoutWindow()

	if (isPopout) {
		return (
			<PopoutTitlebar
				sessionId={sessionId}
				sessionTitle={sessionTitle}
				projectName={projectName}
				isStreaming={isStreaming}
				className={className}
			/>
		)
	}

	return (
		<MainTitlebar
			sessionId={sessionId}
			sessionTitle={sessionTitle}
			projectName={projectName}
			directory={directory}
			isStreaming={isStreaming}
			className={className}
		/>
	)
}

// ── Main window titlebar ────────────────────────────────────────────────

function MainTitlebar({
	sessionId,
	sessionTitle,
	projectName,
	directory,
	isStreaming,
	className,
}: ContentTitlebarProps) {
	const sidebarOpen = useUIStore((s) => s.sidebarOpen)
	const toggleSidebar = useUIStore((s) => s.toggleSidebar)
	const toggleTerminal = useTerminalStore((s) => s.togglePanel)
	const terminalOpen = useTerminalStore((s) => s.panelOpen)

	const handlePopout = useCallback(() => {
		if (!sessionId || !directory) return
		desktopBridge.popoutSession(sessionId, directory, sessionTitle ?? "Session")
	}, [sessionId, directory, sessionTitle])

	return (
		<div
			className={cn(
				"flex h-10 shrink-0 items-center justify-between border-b border-border pr-4 select-none",
				className,
			)}
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
		>
			{/* Left: session info (no-drag so buttons are clickable) */}
			<div
				className="flex min-w-0 items-center gap-2"
				style={
					{
						WebkitAppRegion: "no-drag",
						marginLeft: sidebarOpen ? 8 : 96,
					} as React.CSSProperties
				}
			>
				{/* Sidebar toggle */}
				<button
					type="button"
					onClick={toggleSidebar}
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
					aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
				>
					<SidebarLeft className="w-3.5 h-3.5" aria-hidden="true" />
				</button>
				{sessionTitle ? (
					<>
						<span className="truncate text-sm font-medium text-foreground">{sessionTitle}</span>
						{projectName && <span className="shrink-0 text-xs text-muted">{projectName}</span>}
						{/* Three-dot menu */}
						<button
							type="button"
							className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-foreground"
							title="More options"
							aria-label="More options"
						>
							<DotsHorizontalMoreMenu className="w-3.5 h-3.5" aria-hidden="true" />
						</button>
					</>
				) : (
					<span className="text-sm text-muted">New session</span>
				)}
				{isStreaming && (
					<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
				)}
			</div>

			{/* Right: action buttons (no-drag so buttons are clickable) */}
			<div
				className="flex items-center gap-1"
				style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
			>
				<EditorDropdown />

				<div className="mx-1 h-4 w-px bg-border" />

				{/* Create PR button (green accent) */}
				<button
					type="button"
					className="flex h-7 items-center gap-1 rounded-md bg-success/15 px-2.5 text-xs font-medium text-success transition-colors hover:bg-success/25"
				>
					<Branch className="w-3 h-3" aria-hidden="true" />
					<span>Create PR</span>
				</button>

				<div className="mx-1 h-4 w-px bg-border" />

				{/* Terminal toggle */}
				<button
					type="button"
					onClick={toggleTerminal}
					className={cn(
						"flex h-7 w-7 items-center justify-center rounded-md transition-colors",
						terminalOpen
							? "bg-accent/15 text-accent"
							: "text-muted hover:bg-surface-hover hover:text-foreground",
					)}
					title={terminalOpen ? "Close terminal (Ctrl+`)" : "Open terminal (Ctrl+`)"}
					aria-label={terminalOpen ? "Close terminal" : "Open terminal"}
				>
					<Terminal className="w-3.5 h-3.5" aria-hidden="true" />
				</button>

				{/* Popout button — only shown for existing sessions */}
				{sessionId && (
					<button
						type="button"
						onClick={handlePopout}
						className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
						title="Open in popout window"
						aria-label="Open in popout window"
					>
						<PopOutWindow className="w-3.5 h-3.5" aria-hidden="true" />
					</button>
				)}
			</div>
		</div>
	)
}

// ── Popout window titlebar ──────────────────────────────────────────────

function PopoutTitlebar({
	sessionId,
	sessionTitle,
	projectName,
	isStreaming,
	className,
}: Omit<ContentTitlebarProps, "directory">) {
	const handleClose = useCallback(() => {
		desktopBridge.closePopout()
	}, [])

	const handleReturnToMain = useCallback(() => {
		if (!sessionId) return
		desktopBridge.returnToMain(sessionId)
	}, [sessionId])

	return (
		<div
			className={cn(
				"flex h-10 shrink-0 items-center justify-between border-b border-border px-4 select-none",
				className,
			)}
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
		>
			{/* Left: close button + session title */}
			<div
				className="flex min-w-0 items-center gap-2"
				style={
					{
						WebkitAppRegion: "no-drag",
						// On macOS, leave room for traffic lights
						marginLeft: navigator.userAgent.includes("Mac") ? 72 : 0,
					} as React.CSSProperties
				}
			>
				<button
					type="button"
					onClick={handleClose}
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					title="Close popout"
					aria-label="Close popout"
				>
					<X className="w-4 h-4" aria-hidden="true" />
				</button>

				{sessionTitle && (
					<span className="truncate text-sm font-medium text-foreground">{sessionTitle}</span>
				)}
				{projectName && <span className="shrink-0 text-xs text-muted">{projectName}</span>}
				{isStreaming && (
					<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
				)}
			</div>

			{/* Right: return to main */}
			<div
				className="flex items-center gap-1"
				style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
			>
				<button
					type="button"
					onClick={handleReturnToMain}
					className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					title="Open in Main Window"
					aria-label="Open in Main Window"
				>
					<PopOutWindow className="w-3.5 h-3.5" aria-hidden="true" />
					<span>Open in Main Window</span>
				</button>
			</div>
		</div>
	)
}

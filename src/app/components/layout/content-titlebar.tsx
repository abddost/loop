import {
	FolderSharedOpen,
	PopOutWindow,
	SidebarLeft,
	Terminal,
	X,
} from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useRef, useState } from "react"
import { desktopBridge } from "../../lib/desktop-bridge"
import { isPopoutWindow } from "../../lib/popout"
import { useFilePanelStore } from "../../stores/file-panel-store"
import { useTerminalStore } from "../../stores/terminal-store"
import { useUIStore } from "../../stores/ui-store"
import { cn } from "../ui/cn"
import { Tooltip } from "../ui/tooltip"
import { EditorDropdown } from "./editor-dropdown"
import { TitlebarMenu } from "./titlebar-menu"

export interface ContentTitlebarProps {
	sessionId?: string
	sessionTitle?: string
	projectName?: string
	directory?: string
	isStreaming?: boolean
	onRenameSession?: (newTitle: string) => void
	onArchiveSession?: () => void
	/** Increment to trigger rename mode from a keybinding. */
	renameTrigger?: number
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
	onRenameSession,
	onArchiveSession,
	renameTrigger,
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
			onRenameSession={onRenameSession}
			onArchiveSession={onArchiveSession}
			renameTrigger={renameTrigger}
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
	onRenameSession,
	onArchiveSession,
	renameTrigger,
	className,
}: ContentTitlebarProps) {
	const sidebarOpen = useUIStore((s) => s.sidebarOpen)
	const toggleSidebar = useUIStore((s) => s.toggleSidebar)
	const toggleTerminal = useTerminalStore((s) => s.togglePanel)
	const terminalOpen = useTerminalStore((s) => s.panelOpen)
	const toggleFilePanel = useFilePanelStore((s) => s.togglePanel)
	const filePanelOpen = useFilePanelStore((s) => s.panelOpen)

	// Inline rename state
	const [renaming, setRenaming] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)

	const startRename = useCallback(() => {
		setRenaming(true)
		requestAnimationFrame(() => inputRef.current?.select())
	}, [])

	// Trigger rename from keybinding
	useEffect(() => {
		if (renameTrigger && renameTrigger > 0 && sessionTitle) {
			startRename()
		}
	}, [renameTrigger, sessionTitle, startRename])

	const handleRenameCommit = useCallback(
		(value: string) => {
			setRenaming(false)
			const trimmed = value.trim()
			if (trimmed && trimmed !== sessionTitle) {
				onRenameSession?.(trimmed)
			}
		},
		[sessionTitle, onRenameSession],
	)

	const handlePopout = useCallback(() => {
		if (!sessionId || !directory) return
		desktopBridge.popoutSession(sessionId, directory, sessionTitle ?? "Session")
	}, [sessionId, directory, sessionTitle])

	return (
		<div
			className={cn("flex h-10 shrink-0 items-center justify-between pr-4 select-none", className)}
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
				<Tooltip content={sidebarOpen ? "Hide sidebar" : "Show sidebar"} shortcut="sidebar.toggle">
					<button
						type="button"
						onClick={toggleSidebar}
						className="el-surface-hover flex h-6 w-6 shrink-0 items-center justify-center text-muted hover:text-foreground"
						aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
					>
						<SidebarLeft className="w-3.5 h-3.5" aria-hidden="true" />
					</button>
				</Tooltip>
				{sessionTitle ? (
					renaming ? (
						<input
							ref={inputRef}
							type="text"
							defaultValue={sessionTitle}
							className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-0.5 text-sm text-foreground outline-none focus:border-accent"
							onKeyDown={(e) => {
								if (e.key === "Enter") handleRenameCommit((e.target as HTMLInputElement).value)
								else if (e.key === "Escape") setRenaming(false)
							}}
							onBlur={(e) => handleRenameCommit(e.target.value)}
						/>
					) : (
						<>
							<span className="truncate text-sm font-medium text-foreground">{sessionTitle}</span>
							{projectName && <span className="shrink-0 text-xs text-muted">{projectName}</span>}
							{sessionId && directory && onArchiveSession && (
								<TitlebarMenu
									sessionId={sessionId}
									directory={directory}
									onStartRename={startRename}
									onArchive={onArchiveSession}
								/>
							)}
						</>
					)
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

				<div className="mx-1 h-4 w-px shadow-[var(--shadow-inset)]" />

				{/* Terminal toggle */}
				<Tooltip
					content={terminalOpen ? "Close terminal" : "Open terminal"}
					shortcut="terminal.toggle"
				>
					<button
						type="button"
						onClick={toggleTerminal}
						className={cn(
							"el-surface-hover flex h-7 w-7 items-center justify-center",
							terminalOpen ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground",
						)}
						aria-label={terminalOpen ? "Close terminal" : "Open terminal"}
					>
						<Terminal className="w-3.5 h-3.5" aria-hidden="true" />
					</button>
				</Tooltip>

				{/* File panel toggle */}
				<Tooltip
					content={filePanelOpen ? "Close file panel" : "Open file panel"}
					shortcut="filePanel.toggle"
				>
					<button
						type="button"
						onClick={toggleFilePanel}
						className={cn(
							"el-surface-hover flex h-7 w-7 items-center justify-center",
							filePanelOpen ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground",
						)}
						aria-label={filePanelOpen ? "Close file panel" : "Open file panel"}
					>
						<FolderSharedOpen className="w-3.5 h-3.5" aria-hidden="true" />
					</button>
				</Tooltip>

				{/* Popout button — only shown for existing sessions */}
				{sessionId && (
					<Tooltip content="Open in popout window">
						<button
							type="button"
							onClick={handlePopout}
							className="el-surface-hover flex h-7 w-7 items-center justify-center text-muted hover:text-foreground"
							aria-label="Open in popout window"
						>
							<PopOutWindow className="w-3.5 h-3.5" aria-hidden="true" />
						</button>
					</Tooltip>
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
		const ctx = desktopBridge.getPopoutContext()
		desktopBridge.returnToMain(sessionId, ctx?.directory ?? "")
	}, [sessionId])

	return (
		<div
			className={cn("flex h-10 shrink-0 items-center justify-between px-4 select-none", className)}
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
				<Tooltip content="Close popout">
					<button
						type="button"
						onClick={handleClose}
						className="el-surface-hover flex h-6 w-6 shrink-0 items-center justify-center text-muted hover:text-foreground"
						aria-label="Close popout"
					>
						<X className="w-4 h-4" aria-hidden="true" />
					</button>
				</Tooltip>

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
				<Tooltip content="Open in Main Window">
					<button
						type="button"
						onClick={handleReturnToMain}
						className="el-surface-hover flex h-7 items-center gap-1.5 px-2.5 text-xs font-medium text-muted hover:text-foreground"
						aria-label="Open in Main Window"
					>
						<PopOutWindow className="w-3.5 h-3.5" aria-hidden="true" />
						<span>Open in Main Window</span>
					</button>
				</Tooltip>
			</div>
		</div>
	)
}

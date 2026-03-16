import { useUIStore } from "../../stores/ui-store"
import { cn } from "../ui/cn"

export interface ContentTitlebarProps {
	sessionTitle?: string
	projectName?: string
	isStreaming?: boolean
	className?: string
}

/**
 * Main content area titlebar showing current session info and action buttons.
 * Mirrors the top bar seen in desktop code agent GUIs.
 */
export function ContentTitlebar({
	sessionTitle,
	projectName,
	isStreaming,
	className,
}: ContentTitlebarProps) {
	const sidebarOpen = useUIStore((s) => s.sidebarOpen)
	const toggleSidebar = useUIStore((s) => s.toggleSidebar)

	return (
		<div
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			className={cn(
				"flex h-10 shrink-0 items-center justify-between border-b border-border px-4 select-none",
				className,
			)}
		>
			{/* Left: session info */}
			<div className="flex min-w-0 items-center gap-2">
				{/* Sidebar toggle */}
				<button
					type="button"
					onClick={toggleSidebar}
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
					aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<rect x="3" y="3" width="18" height="18" rx="2" />
						<path d="M9 3v18" />
					</svg>
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
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="currentColor"
								aria-hidden="true"
							>
								<circle cx="5" cy="12" r="1.5" />
								<circle cx="12" cy="12" r="1.5" />
								<circle cx="19" cy="12" r="1.5" />
							</svg>
						</button>
					</>
				) : (
					<span className="text-sm text-muted">New session</span>
				)}
				{isStreaming && (
					<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
				)}
			</div>

			{/* Right: action buttons */}
			<div className="flex items-center gap-1">
				{/* Open button with dropdown chevron */}
				<button
					type="button"
					className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-foreground transition-colors hover:bg-surface-hover"
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
						<polyline points="15 3 21 3 21 9" />
						<line x1="10" y1="14" x2="21" y2="3" />
					</svg>
					<span>Open</span>
					<svg
						width="10"
						height="10"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.5"
						aria-hidden="true"
						className="ml-0.5 text-muted"
					>
						<path d="M6 9l6 6 6-6" />
					</svg>
				</button>

				{/* Hand off button */}
				<button
					type="button"
					className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-foreground transition-colors hover:bg-surface-hover"
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M17 1l4 4-4 4" />
						<path d="M3 11V9a4 4 0 014-4h14" />
						<path d="M7 23l-4-4 4-4" />
						<path d="M21 13v2a4 4 0 01-4 4H3" />
					</svg>
					<span>Hand off</span>
				</button>

				<div className="mx-1 h-4 w-px bg-border" />

				{/* Create PR button (green accent) */}
				<button
					type="button"
					className="flex h-7 items-center gap-1 rounded-md bg-success/15 px-2.5 text-xs font-medium text-success transition-colors hover:bg-success/25"
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<circle cx="18" cy="18" r="3" />
						<circle cx="6" cy="6" r="3" />
						<path d="M13 6h3a2 2 0 012 2v7" />
						<path d="M6 9v12" />
					</svg>
					<span>Create PR</span>
				</button>

				<div className="mx-1 h-4 w-px bg-border" />

				{/* Extra icon buttons (visual parity with reference screenshot) */}
				<button
					type="button"
					className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					title="Timeline"
					aria-label="Timeline"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<rect x="3" y="3" width="18" height="18" rx="2" />
						<path d="M3 9h18" />
						<path d="M9 21V9" />
					</svg>
				</button>
				<button
					type="button"
					className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					title="Layout"
					aria-label="Layout"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<rect x="3" y="3" width="7" height="7" rx="1" />
						<rect x="14" y="3" width="7" height="7" rx="1" />
						<rect x="3" y="14" width="7" height="7" rx="1" />
						<rect x="14" y="14" width="7" height="7" rx="1" />
					</svg>
				</button>
				<button
					type="button"
					className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					title="Settings"
					aria-label="Settings"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
					</svg>
				</button>
			</div>
		</div>
	)
}

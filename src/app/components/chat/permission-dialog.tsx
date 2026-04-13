import { useState } from "react"
import type { PermissionRequest } from "../../stores/workspace-store"
import { cn } from "../ui/cn"

export interface PermissionDialogProps {
	request: PermissionRequest
	onAllow: () => void
	onAllowAlways: () => void
	onDeny: () => void
	className?: string
}

/** Max visible height for the patterns/content block before collapsing. */
const CONTENT_MAX_HEIGHT = 120 // px — ~6 lines of monospace text
/** Patterns longer than this character count are considered "long" and get the collapse treatment. */
const LONG_PATTERN_THRESHOLD = 200

/**
 * Tools where the user must see the full target before approving. For
 * bash/edit/write the pattern IS the action (command or file path), and
 * a silent truncation could hide a malicious suffix like `&& rm -rf /`
 * or a path traversal component. We start expanded for these so the user
 * sees every character before clicking Allow.
 */
const ALWAYS_EXPAND_TOOLS = new Set(["bash", "edit", "write", "multi-edit", "patch"])

export function PermissionDialog({
	request,
	onAllow,
	onAllowAlways,
	onDeny,
	className,
}: PermissionDialogProps) {
	const isDoom = request.type === "doom_loop"
	const patterns = request.patterns ?? []
	const isBatch = (request.input as Record<string, unknown>)?.batch === true
	const count = (request.input as Record<string, unknown>)?.count as number | undefined
	const MAX_VISIBLE_PATTERNS = 5

	// Determine if content is long enough to warrant collapsing
	const totalPatternLength = patterns.reduce((sum, p) => sum + p.length, 0)
	const hasLongContent =
		totalPatternLength > LONG_PATTERN_THRESHOLD || patterns.length > MAX_VISIBLE_PATTERNS
	const mustShowFull = ALWAYS_EXPAND_TOOLS.has(request.tool)
	const [expanded, setExpanded] = useState(mustShowFull)

	return (
		<div className={cn("mx-auto w-full max-w-[52rem] px-12 pb-2", className)}>
			<div
				className={cn(
					"rounded-xl p-4",
					isDoom
						? "bg-destructive/5 shadow-[var(--shadow-inset)]"
						: "bg-surface shadow-[var(--shadow-card)]",
				)}
			>
				<p className="mb-1 text-sm text-foreground">
					Allow{" "}
					<span className={cn("font-semibold", isDoom ? "text-destructive" : "text-accent")}>
						{request.tool}
					</span>
					{isBatch && count ? ` (${count} call${count !== 1 ? "s" : ""})` : ""} to execute?
				</p>

				{patterns.length > 0 && (
					<div className="mb-3">
						<div
							className={cn(
								"overflow-hidden rounded-lg bg-background/60 p-2.5 font-mono text-xs text-muted",
								"[&::-webkit-scrollbar]:w-1.5",
								"[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
								hasLongContent && !expanded && "relative",
								expanded && "max-h-60 overflow-auto",
							)}
							style={
								hasLongContent && !expanded ? { maxHeight: `${CONTENT_MAX_HEIGHT}px` } : undefined
							}
						>
							<div className="space-y-0.5">
								{(expanded ? patterns : patterns.slice(0, MAX_VISIBLE_PATTERNS)).map((p) => (
									<p key={p} className="break-all leading-relaxed">
										{p}
									</p>
								))}
								{!expanded && patterns.length > MAX_VISIBLE_PATTERNS && (
									<p className="text-muted-foreground/60">
										...and {patterns.length - MAX_VISIBLE_PATTERNS} more
									</p>
								)}
							</div>

							{/* Fade overlay when collapsed */}
							{hasLongContent && !expanded && (
								<div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background/80 to-transparent rounded-b-lg" />
							)}
						</div>

						{hasLongContent && (
							<button
								type="button"
								onClick={() => setExpanded(!expanded)}
								className="mt-1 text-xs text-accent/70 transition-colors hover:text-accent"
							>
								{expanded ? "Show less" : "Show more"}
							</button>
						)}
					</div>
				)}

				{request.reason && !hasLongContent && (
					<p className="mb-3 text-xs text-muted">{request.reason}</p>
				)}

				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onAllow}
						className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
					>
						Allow once
					</button>
					<button
						type="button"
						onClick={onAllowAlways}
						className="el-surface-hover rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
					>
						Always allow
					</button>
					<button
						type="button"
						onClick={onDeny}
						className="el-surface-hover rounded-lg px-3 py-1.5 text-xs font-medium text-muted shadow-[var(--shadow-inset)] transition-colors hover:text-foreground"
					>
						Reject
					</button>
				</div>
			</div>
		</div>
	)
}

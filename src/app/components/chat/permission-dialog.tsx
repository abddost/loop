import type { PermissionRequest } from "../../stores/workspace-store"
import { cn } from "../ui/cn"

export interface PermissionDialogProps {
	request: PermissionRequest
	onAllow: () => void
	onAllowAlways: () => void
	onDeny: () => void
	className?: string
}

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

	return (
		<div className={cn("mx-auto w-full max-w-[52rem] px-12 pb-2", className)}>
			<div
				className={cn(
					"rounded-xl border p-4",
					isDoom ? "border-destructive/20 bg-destructive/5" : "border-border bg-surface",
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
					<div className="mb-3 space-y-0.5">
						{patterns.slice(0, MAX_VISIBLE_PATTERNS).map((p) => (
							<p key={p} className="font-mono text-xs text-muted">
								{p}
							</p>
						))}
						{patterns.length > MAX_VISIBLE_PATTERNS && (
							<p className="text-xs text-muted">
								...and {patterns.length - MAX_VISIBLE_PATTERNS} more
							</p>
						)}
					</div>
				)}

				{request.reason && <p className="mb-3 text-xs text-muted">{request.reason}</p>}

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
						className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					>
						Always allow
					</button>
					<button
						type="button"
						onClick={onDeny}
						className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					>
						Reject
					</button>
				</div>
			</div>
		</div>
	)
}

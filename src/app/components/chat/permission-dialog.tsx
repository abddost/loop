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
	const displayPattern = patterns.length > 0 ? patterns[0] : undefined

	return (
		<div className={cn("mx-auto w-full max-w-4xl px-12 pb-2", className)}>
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
					</span>{" "}
					to execute?
				</p>

				{displayPattern && <p className="mb-3 font-mono text-xs text-muted">{displayPattern}</p>}

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

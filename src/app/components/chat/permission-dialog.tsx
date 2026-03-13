import type { PermissionRequest } from "../../stores/workspace-store"
import { Button } from "../ui/button"
import { cn } from "../ui/cn"

export interface PermissionDialogProps {
	request: PermissionRequest
	onAllow: () => void
	onAllowAlways: () => void
	onDeny: () => void
	className?: string
}

/**
 * Inline permission request displayed within the chat.
 * Shows the tool/action and provides allow/deny options.
 */
export function PermissionDialog({
	request,
	onAllow,
	onAllowAlways,
	onDeny,
	className,
}: PermissionDialogProps) {
	return (
		<div
			className={cn("rounded-[--radius-md] border border-warning/30 bg-warning/5 p-4", className)}
		>
			<p className="mb-3 text-sm text-foreground">
				Allow <span className="font-semibold text-warning">{request.tool}</span> to execute?
			</p>
			{request.reason && <p className="mb-3 text-xs text-muted">{request.reason}</p>}
			<div className="flex items-center gap-2">
				<Button size="sm" onClick={onAllow}>
					Yes
				</Button>
				<Button variant="ghost" size="sm" onClick={onAllowAlways}>
					Yes, don&apos;t ask again
				</Button>
				<Button variant="outline" size="sm" onClick={onDeny}>
					No
				</Button>
			</div>
		</div>
	)
}

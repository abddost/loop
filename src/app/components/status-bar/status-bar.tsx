import { cn } from "../ui/cn"
import { ModeIndicator } from "./mode-indicator"
import { PermissionMode, type PermissionModeValue } from "./permission-mode"
import { VcsStatus } from "./vcs-status"

export interface StatusBarProps {
	permissionMode: PermissionModeValue
	onPermissionModeChange: (mode: PermissionModeValue) => void
	branch?: string
	onCreateRepo?: () => void
	className?: string
}

/**
 * Bottom status bar: mode indicator (left), permission mode (center), VCS status (right).
 */
export function StatusBar({
	permissionMode,
	onPermissionModeChange,
	branch,
	onCreateRepo,
	className,
}: StatusBarProps) {
	return (
		<div
			className={cn("shrink-0 border-t border-border bg-background text-xs text-muted", className)}
		>
			<div className="mx-auto flex h-8 w-full max-w-4xl items-center justify-between px-12">
				<ModeIndicator />
				<PermissionMode value={permissionMode} onChange={onPermissionModeChange} />
				<VcsStatus branch={branch} onCreateRepo={onCreateRepo} />
			</div>
		</div>
	)
}

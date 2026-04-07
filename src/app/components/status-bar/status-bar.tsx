import { Tasks } from "@openai/apps-sdk-ui/components/Icon"
import { cn } from "../ui/cn"
import { PermissionMode, type PermissionModeValue } from "./permission-mode"
import { VcsStatus } from "./vcs-status"
import { WorkspaceMode } from "./workspace-mode"

export interface StatusBarProps {
	permissionMode: PermissionModeValue
	onPermissionModeChange: (mode: PermissionModeValue) => void
	branch?: string
	/** Show workspace mode selector (Local / Sandbox). */
	isNewSession?: boolean
	hasGit?: boolean
	parentDirectory?: string
	hasTodos?: boolean
	todoDone?: number
	todoTotal?: number
	todosOpen?: boolean
	onToggleTodos?: () => void
	className?: string
}

export function StatusBar({
	permissionMode,
	onPermissionModeChange,
	branch,
	isNewSession,
	hasGit,
	parentDirectory,
	hasTodos,
	todoDone,
	todoTotal,
	todosOpen,
	onToggleTodos,
	className,
}: StatusBarProps) {
	return (
		<div
			className={cn("shrink-0 border-t border-border bg-background text-xs text-muted", className)}
		>
			<div className="mx-auto flex h-8 w-full max-w-[52rem] items-center justify-between px-12">
				<div className="flex items-center gap-3">
					{isNewSession && hasGit && parentDirectory && (
						<WorkspaceMode parentDirectory={parentDirectory} />
					)}
					<PermissionMode value={permissionMode} onChange={onPermissionModeChange} />
				</div>
				<div className="flex items-center gap-2">
					{hasTodos && onToggleTodos && (
						<button
							type="button"
							onClick={onToggleTodos}
							className={cn(
								"flex items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors",
								todosOpen ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground",
							)}
							aria-label="Toggle tasks"
						>
							<Tasks className="h-3.5 w-3.5" aria-hidden="true" />
							<span>Tasks{todoTotal ? ` ${todoDone ?? 0}/${todoTotal}` : ""}</span>
						</button>
					)}
					<VcsStatus branch={branch} />
				</div>
			</div>
		</div>
	)
}

import { ArrowUpRight, Compass, Tasks } from "@openai/apps-sdk-ui/components/Icon"
import { cn } from "../ui/cn"
import { Tooltip } from "../ui/tooltip"
import { ChatSettings } from "./chat-settings"
import { PermissionMode, type PermissionModeValue } from "./permission-mode"
import { VcsStatus } from "./vcs-status"
import { WorkspaceMode } from "./workspace-mode"

export interface StatusBarProps {
	permissionMode: PermissionModeValue
	onPermissionModeChange: (mode: PermissionModeValue) => void
	/** Hide the permission selector (already shown in input bar for Claude Code). */
	isClaudeCode?: boolean
	branch?: string
	isNewSession?: boolean
	hasGit?: boolean
	/** Project directory (canonical, not worktree). Used to list available worktrees. */
	parentDirectory?: string
	/** Active session's directory (may be a worktree path). Used to derive current workspace. */
	sessionDirectory?: string
	hasPlan?: boolean
	onScrollToPlan?: () => void
	/** When set, the Plan affordance grows a sibling button that opens the
	 *  on-disk plan file (`metadata.planPath`) in the user's default editor. */
	onOpenPlanFile?: () => void
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
	isClaudeCode,
	branch,
	isNewSession,
	hasGit,
	parentDirectory,
	sessionDirectory,
	hasPlan,
	onScrollToPlan,
	onOpenPlanFile,
	hasTodos,
	todoDone,
	todoTotal,
	todosOpen,
	onToggleTodos,
	className,
}: StatusBarProps) {
	return (
		<div className={cn("shrink-0 text-xs tracking-el-ui text-muted", className)}>
			<div className="mx-auto flex h-8 w-full max-w-[52rem] items-center justify-between px-12">
				<div className="flex items-center gap-3">
					{hasGit && parentDirectory && (
						<WorkspaceMode
							parentDirectory={parentDirectory}
							sessionDirectory={sessionDirectory}
							isNewSession={isNewSession}
						/>
					)}
					{!isClaudeCode && (
						<PermissionMode value={permissionMode} onChange={onPermissionModeChange} />
					)}
				</div>
				<div className="flex items-center gap-2">
					{hasPlan && onScrollToPlan && (
						<div className="el-surface-hover flex items-center text-muted">
							<Tooltip content="Scroll to plan in chat">
								<button
									type="button"
									onClick={onScrollToPlan}
									className="flex items-center gap-1.5 px-2 py-0.5 hover:text-foreground"
									aria-label="Scroll to plan"
								>
									<Compass className="h-3.5 w-3.5" aria-hidden="true" />
									<span>Plan</span>
								</button>
							</Tooltip>
							{onOpenPlanFile && (
								<Tooltip content="Open plan file in editor">
									<button
										type="button"
										onClick={onOpenPlanFile}
										className="flex h-full items-center border-l border-border/40 px-1.5 py-0.5 hover:text-foreground"
										aria-label="Open plan file in editor"
									>
										<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
									</button>
								</Tooltip>
							)}
						</div>
					)}
					{hasTodos && onToggleTodos && (
						<button
							type="button"
							onClick={onToggleTodos}
							className={cn(
								"el-surface-hover flex items-center gap-1.5 px-2 py-0.5",
								todosOpen ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground",
							)}
							aria-label="Toggle tasks"
						>
							<Tasks className="h-3.5 w-3.5" aria-hidden="true" />
							<span>Tasks{todoTotal ? ` ${todoDone ?? 0}/${todoTotal}` : ""}</span>
						</button>
					)}
					<ChatSettings />
					<VcsStatus branch={branch} />
				</div>
			</div>
		</div>
	)
}

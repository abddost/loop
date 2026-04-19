import { type KeyboardEvent, useCallback, useRef, useState } from "react"
import { cn } from "../ui/cn"

export interface PlanApprovalDialogProps {
	/** Accept plan — switch to "default" (ask permissions) mode. */
	onAccept: () => void
	/** Accept plan — switch to "acceptEdits" mode. */
	onAcceptAllowEdits: () => void
	/** Revise plan — send feedback to Claude. */
	onRevise: (message: string) => void
	className?: string
}

/**
 * Plan approval dialog shown when Claude Code proposes a plan via
 * `ExitPlanMode`. Replaces the generic `PermissionDialog` for plan
 * approval requests (`type === "plan_approval"`).
 *
 * Three actions:
 *   - "Revise..." — opens a text input for revision feedback
 *   - "Accept"   — accept plan, implementation uses ask-permissions mode
 *   - "Accept, allow edits" — accept plan, implementation auto-approves edits
 */
export function PlanApprovalDialog({
	onAccept,
	onAcceptAllowEdits,
	onRevise,
	className,
}: PlanApprovalDialogProps) {
	const [revising, setRevising] = useState(false)
	const [revisionText, setRevisionText] = useState("")
	const inputRef = useRef<HTMLTextAreaElement>(null)

	const handleReviseClick = useCallback(() => {
		setRevising(true)
		requestAnimationFrame(() => inputRef.current?.focus())
	}, [])

	const handleReviseSubmit = useCallback(() => {
		const trimmed = revisionText.trim()
		if (!trimmed) return
		onRevise(trimmed)
	}, [revisionText, onRevise])

	const handleReviseKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				handleReviseSubmit()
			}
			if (e.key === "Escape") {
				e.preventDefault()
				setRevising(false)
				setRevisionText("")
			}
		},
		[handleReviseSubmit],
	)

	return (
		<div className={cn("mx-auto w-full max-w-[52rem] px-12 pb-2", className)}>
			<div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-card)]">
				{/* Header */}
				<p className="mb-3 text-sm font-medium text-foreground">Claude proposed a plan</p>

				{/* Revision input */}
				{revising && (
					<div className="mb-3">
						<textarea
							ref={inputRef}
							value={revisionText}
							onChange={(e) => setRevisionText(e.target.value)}
							onKeyDown={handleReviseKeyDown}
							placeholder="Describe how to revise the plan..."
							rows={2}
							className="w-full resize-none rounded-lg bg-background/60 p-2.5 text-xs text-foreground placeholder:text-placeholder focus:outline-none"
						/>
						<div className="mt-1.5 flex items-center gap-2">
							<button
								type="button"
								onClick={handleReviseSubmit}
								disabled={!revisionText.trim()}
								className={cn(
									"rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
									revisionText.trim()
										? "bg-accent text-white hover:opacity-90"
										: "bg-surface-hover text-muted cursor-not-allowed",
								)}
							>
								Send revision
							</button>
							<button
								type="button"
								onClick={() => {
									setRevising(false)
									setRevisionText("")
								}}
								className="rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
							>
								Cancel
							</button>
						</div>
					</div>
				)}

				{/* Actions */}
				<div className="flex items-center justify-between">
					{/* Left: Revise */}
					{!revising && (
						<button
							type="button"
							onClick={handleReviseClick}
							className="el-surface-hover rounded-lg px-3 py-1.5 text-xs text-muted shadow-[var(--shadow-inset)] transition-colors hover:text-foreground"
						>
							Revise...
							<span className="ml-1.5 text-[10px] opacity-50">esc</span>
						</button>
					)}
					{revising && <div />}

					{/* Right: Accept buttons */}
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onAccept}
							className="el-surface-hover rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
						>
							Accept
						</button>
						<button
							type="button"
							onClick={onAcceptAllowEdits}
							className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
						>
							Accept, allow edits
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}

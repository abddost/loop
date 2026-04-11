import {
	Check,
	ChevronDown,
	ClipboardCopy,
	Download,
	Expand,
} from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useRef, useState } from "react"
import { useWorkspaceState } from "../../hooks/use-workspace"
import { apiClient } from "../../lib/api-client"
import { useUIStore } from "../../stores/ui-store"
import type { Question } from "../../stores/workspace-store"
import { workspaceStoreRegistry } from "../../stores/workspace-store"
import { cn } from "../ui/cn"
import { Markdown } from "./markdown"

// ─── Plan Card ───────────────────────────────────────────────────

export interface PlanCardProps {
	content: string
	planPath?: string
	isExpanded?: boolean
	className?: string
}

/** Maximum collapsed height in pixels before gradient fade appears. */
const COLLAPSED_HEIGHT = 300

/**
 * Renders a plan as a styled card with markdown content,
 * collapsible body, and header actions (download, copy, expand).
 */
export function PlanCard({
	content,
	planPath,
	isExpanded: initialExpanded = false,
	className,
}: PlanCardProps) {
	const [expanded, setExpanded] = useState(initialExpanded)
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(content)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [content])

	const handleDownload = useCallback(() => {
		const blob = new Blob([content], { type: "text/markdown" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = planPath ? (planPath.split("/").pop() ?? "plan.md") : "plan.md"
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
	}, [content, planPath])

	return (
		<div className={cn("el-card bg-surface/40 overflow-hidden", className)}>
			{/* Header */}
			<div className="flex items-center justify-between px-3.5 py-2.5">
				<span className="text-sm font-semibold text-foreground">Plan</span>
				<div className="flex items-center gap-1">
					<HeaderButton
						label="Download"
						onClick={handleDownload}
						icon={<Download className="h-3.5 w-3.5" />}
					/>
					<HeaderButton
						label={copied ? "Copied!" : "Copy"}
						onClick={handleCopy}
						icon={
							copied ? (
								<Check className="h-3.5 w-3.5 text-success" />
							) : (
								<ClipboardCopy className="h-3.5 w-3.5" />
							)
						}
					/>
					<HeaderButton
						label={expanded ? "Collapse" : "Expand"}
						onClick={() => setExpanded(!expanded)}
						icon={
							<Expand className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-45")} />
						}
					/>
				</div>
			</div>

			{/* Content area */}
			<div className="border-t border-[var(--separator)]">
				<div className="relative">
					<div
						className={cn(
							"overflow-hidden px-4 py-3 transition-[max-height] duration-300 ease-out",
							!expanded && "max-h-[300px]",
						)}
						style={expanded ? undefined : { maxHeight: `${COLLAPSED_HEIGHT}px` }}
					>
						<Markdown text={content} className="text-sm leading-relaxed text-foreground" />
					</div>

					{/* Gradient fade + expand button when collapsed */}
					{!expanded && (
						<div className="absolute inset-x-0 bottom-0 flex flex-col items-center pb-3">
							<div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--surface)] to-transparent" />
							<button
								type="button"
								onClick={() => setExpanded(true)}
								className="relative z-10 flex items-center gap-1.5 rounded-lg border border-border/60 bg-foreground/10 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-foreground/20"
							>
								<ChevronDown className="h-3 w-3" />
								Expand plan
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

// ─── Header action button ────────────────────────────────────────

function HeaderButton({
	label,
	icon,
	onClick,
}: {
	label: string
	icon: React.ReactNode
	onClick: () => void
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover/50 hover:text-foreground"
		>
			{icon}
		</button>
	)
}

// ─── Shared question answer helper ───────────────────────────────

/**
 * Selector for the first pending plan question (plan_enter or plan_exit).
 * Excludes "question" tool questions which are handled by QuestionDialog.
 */
const selectFirstPlanQuestion = (s: { pendingQuestions: Question[] }): Question | undefined =>
	s.pendingQuestions.find((q) => q.tool !== "question")

function useQuestionAnswer() {
	const question = useWorkspaceState(selectFirstPlanQuestion)
	const [answering, setAnswering] = useState(false)

	const answer = useCallback(
		async (response: string) => {
			if (!question || answering) return
			setAnswering(true)
			try {
				await apiClient.post(`/questions/${question.id}`, { answers: [response] })
				const dir = useUIStore.getState().activeDirectory
				if (dir) {
					workspaceStoreRegistry.get(dir)?.getState().resolveQuestion(question.id)
				}
			} catch (err) {
				console.error("[tool:confirmation]", err)
				setAnswering(false)
			}
		},
		[question, answering],
	)

	return { question, answering, answer }
}

// ─── Tool Confirmation (simple yes/no) ──────────────────────────

export interface ToolConfirmationProps {
	/** Heading shown above the buttons. */
	title: string
	/** Label for the accept button. */
	acceptLabel: string
	/** Label for the reject button. */
	rejectLabel: string
	className?: string
}

/**
 * Generic inline confirmation UI for tool calls that use the question
 * mechanism. Used for simple yes/no confirmations (e.g. plan_enter).
 */
export function ToolConfirmation({
	title,
	acceptLabel,
	rejectLabel,
	className,
}: ToolConfirmationProps) {
	const { question, answering, answer } = useQuestionAnswer()

	if (!question) return null

	return (
		<div className={cn("el-card bg-surface/40 p-4", className)}>
			<p className="text-sm font-medium text-foreground mb-3">{title}</p>
			<div className="space-y-2">
				<button
					type="button"
					disabled={answering}
					onClick={() => answer("yes")}
					className={cn(
						"w-full text-left px-3 py-2 rounded-lg border border-border/60 text-sm font-medium transition-colors",
						answering
							? "opacity-50 cursor-not-allowed"
							: "hover:bg-surface-hover/50 hover:border-success/40",
					)}
				>
					<span className="text-success mr-2">1.</span>
					{acceptLabel}
				</button>
				<button
					type="button"
					disabled={answering}
					onClick={() => answer("no")}
					className={cn(
						"w-full text-left px-3 py-2 rounded-lg border border-border/60 text-sm text-muted-foreground transition-colors",
						answering
							? "opacity-50 cursor-not-allowed"
							: "hover:bg-surface-hover/50 hover:border-border",
					)}
				>
					<span className="mr-2">2.</span>
					{rejectLabel}
				</button>
			</div>
		</div>
	)
}

// ─── Plan Approval ───────────────────────────────────────────────

/**
 * Plan approval UI:
 * - Row 1: "Yes, implement this plan" (clickable)
 * - Row 2: Inline text input with placeholder "No, and tell what to do differently"
 *          (user can type feedback directly, no reveal step)
 * - Submit button to send the answer
 */
export function PlanApproval({ className }: { className?: string }) {
	const { question, answering, answer } = useQuestionAnswer()
	const [feedback, setFeedback] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)

	/** Whether the user has typed feedback (selects option 2). */
	const hasFeedback = feedback.trim().length > 0

	const handleSubmit = useCallback(() => {
		if (answering) return
		// If feedback is typed, send as rejection text; otherwise accept
		if (hasFeedback) {
			answer(feedback.trim())
		} else {
			answer("yes")
		}
	}, [answering, hasFeedback, feedback, answer])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault()
				handleSubmit()
			} else if (e.key === "Escape") {
				setFeedback("")
				inputRef.current?.blur()
			}
		},
		[handleSubmit],
	)

	if (!question) return null

	return (
		<div className={cn("el-card bg-surface/40 p-4", className)}>
			<p className="text-sm font-medium text-foreground mb-3">Implement this plan?</p>
			<div className="space-y-2">
				{/* Option 1: Accept */}
				<button
					type="button"
					disabled={answering}
					onClick={() => answer("yes")}
					className={cn(
						"w-full text-left px-3 py-2 rounded-lg border border-border/60 text-sm font-medium transition-colors",
						answering
							? "opacity-50 cursor-not-allowed"
							: "hover:bg-surface-hover/50 hover:border-success/40",
					)}
				>
					<span className="text-success mr-2">1.</span>
					Yes, implement this plan
				</button>

				{/* Option 2: Inline feedback input */}
				<div className="flex items-center gap-2">
					<div className="flex min-w-0 flex-1 items-center rounded-lg border border-border/60 px-3 py-2 transition-colors focus-within:border-accent/60">
						<span className="mr-2 shrink-0 text-sm text-muted-foreground">2.</span>
						<input
							ref={inputRef}
							type="text"
							value={feedback}
							onChange={(e) => setFeedback(e.target.value)}
							onKeyDown={handleKeyDown}
							disabled={answering}
							placeholder="No, and tell what to do differently"
							className={cn(
								"min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none",
								answering && "opacity-50 cursor-not-allowed",
							)}
						/>
					</div>

					{/* Dismiss (ESC) */}
					{hasFeedback && (
						<button
							type="button"
							onClick={() => {
								setFeedback("")
								inputRef.current?.blur()
							}}
							className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							Dismiss
							<kbd className="rounded border border-border/60 bg-surface px-1 py-0.5 text-[10px] font-medium">
								ESC
							</kbd>
						</button>
					)}

					{/* Submit */}
					<button
						type="button"
						disabled={answering}
						onClick={handleSubmit}
						className={cn(
							"flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
							answering
								? "bg-accent/50 text-white/50 cursor-not-allowed"
								: "bg-accent text-white hover:bg-accent/90",
						)}
					>
						Submit
						<kbd className="rounded border border-white/20 bg-white/10 px-1 py-0.5 text-[10px]">
							↵
						</kbd>
					</button>
				</div>
			</div>
		</div>
	)
}

/** Pre-configured confirmation for plan mode switch (plan_enter). */
export function PlanModeConfirmation({ className }: { className?: string }) {
	return (
		<ToolConfirmation
			title="Switch to plan mode?"
			acceptLabel="Yes, switch to plan mode"
			rejectLabel="No, stay in build mode"
			className={className}
		/>
	)
}

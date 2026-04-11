import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react"
import type { Question, QuestionInfo } from "../../stores/workspace-store"
import { cn } from "../ui/cn"

export interface QuestionDialogProps {
	question: Question
	onAnswer: (questionId: string, answers: string[]) => void
	onReject: (questionId: string) => void
	className?: string
}

/**
 * Interactive question dialog rendered at the bottom of the chat.
 * Supports structured questions with selectable options and custom text input.
 * Multi-question support via tab navigation.
 */
export function QuestionDialog({ question, onAnswer, onReject, className }: QuestionDialogProps) {
	const questions = question.questions ?? []
	const isMultiQuestion = questions.length > 1

	// Per-question answer state
	const [tab, setTab] = useState(0)
	const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map())
	const [customTexts, setCustomTexts] = useState<Map<number, string>>(() => new Map())
	const [customActive, setCustomActive] = useState<Set<number>>(() => new Set())
	const [submitting, setSubmitting] = useState(false)
	const customInputRef = useRef<HTMLInputElement>(null)

	const currentQ = questions[tab] as QuestionInfo | undefined
	const currentSelections = selections.get(tab) ?? new Set<string>()
	const currentCustom = customTexts.get(tab) ?? ""
	const isCustomActive = customActive.has(tab)

	// Focus custom input when activated
	useEffect(() => {
		if (isCustomActive) customInputRef.current?.focus()
	}, [isCustomActive])

	const toggleOption = useCallback(
		(label: string) => {
			if (!currentQ) return
			setSelections((prev) => {
				const next = new Map(prev)
				const current = new Set(prev.get(tab) ?? [])
				if (currentQ.multiple) {
					if (current.has(label)) current.delete(label)
					else current.add(label)
				} else {
					// Single select — replace
					current.clear()
					current.add(label)
				}
				next.set(tab, current)
				return next
			})
			// Deactivate custom when selecting a predefined option
			setCustomActive((prev) => {
				const next = new Set(prev)
				next.delete(tab)
				return next
			})
		},
		[tab, currentQ],
	)

	const activateCustom = useCallback(() => {
		// Clear predefined selections when switching to custom
		if (!currentQ?.multiple) {
			setSelections((prev) => {
				const next = new Map(prev)
				next.set(tab, new Set())
				return next
			})
		}
		setCustomActive((prev) => {
			const next = new Set(prev)
			next.add(tab)
			return next
		})
	}, [tab, currentQ?.multiple])

	const updateCustomText = useCallback(
		(text: string) => {
			setCustomTexts((prev) => {
				const next = new Map(prev)
				next.set(tab, text)
				return next
			})
		},
		[tab],
	)

	// Build the answer string for a given question index
	const getAnswerForQuestion = useCallback(
		(idx: number): string => {
			const sel = selections.get(idx) ?? new Set<string>()
			const custom = customTexts.get(idx) ?? ""
			const isCustom = customActive.has(idx)

			if (isCustom && custom.trim()) {
				return custom.trim()
			}
			if (sel.size > 0) {
				return [...sel].join(", ")
			}
			return custom.trim()
		},
		[selections, customTexts, customActive],
	)

	const canSubmit = useCallback(() => {
		// All questions must have an answer
		for (let i = 0; i < questions.length; i++) {
			if (!getAnswerForQuestion(i)) return false
		}
		return true
	}, [questions.length, getAnswerForQuestion])

	const handleSubmit = useCallback(() => {
		if (submitting || !canSubmit()) return
		setSubmitting(true)
		const answers = questions.map((_, i) => getAnswerForQuestion(i))
		onAnswer(question.id, answers)
	}, [submitting, canSubmit, questions, getAnswerForQuestion, onAnswer, question.id])

	const handleDismiss = useCallback(() => {
		if (submitting) return
		onReject(question.id)
	}, [submitting, onReject, question.id])

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				handleDismiss()
			} else if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				handleSubmit()
			}
		},
		[handleDismiss, handleSubmit],
	)

	// Keyboard shortcut: number keys select options
	const handleContainerKeyDown = useCallback(
		(e: KeyboardEvent) => {
			const num = Number.parseInt(e.key, 10)
			if (!Number.isNaN(num) && currentQ?.options) {
				const idx = num - 1
				if (idx >= 0 && idx < currentQ.options.length) {
					e.preventDefault()
					toggleOption(currentQ.options[idx].label)
				}
				// Last number = custom option
				if (idx === currentQ.options.length) {
					e.preventDefault()
					activateCustom()
				}
			}
			if (e.key === "Escape") {
				e.preventDefault()
				handleDismiss()
			}
			if (e.key === "Enter" && !e.shiftKey && !isCustomActive) {
				e.preventDefault()
				handleSubmit()
			}
		},
		[currentQ, toggleOption, activateCustom, handleDismiss, handleSubmit, isCustomActive],
	)

	if (!currentQ) return null

	return (
		<div
			className={cn("mx-auto w-full max-w-[52rem] px-12 pb-2", className)}
			onKeyDown={handleContainerKeyDown}
		>
			<div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-card)]">
				{/* Question text */}
				<p className="mb-3 text-sm text-foreground">{currentQ.question}</p>

				{/* Options */}
				{currentQ.options && currentQ.options.length > 0 && (
					<div className="mb-3 space-y-1.5">
						{currentQ.options.map((opt, idx) => {
							const selected = currentSelections.has(opt.label)
							return (
								<button
									key={opt.label}
									type="button"
									disabled={submitting}
									onClick={() => toggleOption(opt.label)}
									className={cn(
										"flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
										selected
											? "border-accent/60 bg-accent/10 text-foreground border"
											: "text-foreground el-surface-hover shadow-[var(--shadow-inset)]",
										submitting && "opacity-50 cursor-not-allowed",
									)}
								>
									<span className="shrink-0 text-muted-foreground">{idx + 1}.</span>
									<div className="min-w-0 flex-1">
										<span className="font-medium">{opt.label}</span>
										{opt.description && (
											<span className="ml-1.5 text-xs text-muted-foreground">
												{opt.description}
											</span>
										)}
									</div>
									{selected && <SelectedCheck />}
								</button>
							)
						})}

						{/* Custom answer option */}
						<div
							className={cn(
								"flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors",
								isCustomActive
									? "border border-accent/60 bg-accent/10"
									: "el-surface-hover shadow-[var(--shadow-inset)]",
								submitting && "opacity-50",
							)}
						>
							<span className="shrink-0 text-sm text-muted-foreground">
								{(currentQ.options?.length ?? 0) + 1}.
							</span>
							<input
								ref={customInputRef}
								type="text"
								value={currentCustom}
								onChange={(e) => updateCustomText(e.target.value)}
								onFocus={activateCustom}
								onKeyDown={handleKeyDown}
								disabled={submitting}
								placeholder="Type your own answer"
								className={cn(
									"min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none",
									submitting && "cursor-not-allowed",
								)}
							/>
						</div>
					</div>
				)}

				{/* No predefined options — just a text input */}
				{(!currentQ.options || currentQ.options.length === 0) && (
					<div className="mb-3">
						<input
							ref={customInputRef}
							type="text"
							value={currentCustom}
							onChange={(e) => updateCustomText(e.target.value)}
							onFocus={() =>
								setCustomActive((prev) => {
									const next = new Set(prev)
									next.add(tab)
									return next
								})
							}
							onKeyDown={handleKeyDown}
							disabled={submitting}
							placeholder="Type your answer..."
							className="w-full rounded-lg border border-border/60 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-accent/60 focus:outline-none"
						/>
					</div>
				)}

				{/* Footer: tabs (multi-question) + dismiss + submit */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						{/* Multi-question tab navigation */}
						{isMultiQuestion && (
							<div className="flex items-center gap-1 mr-3">
								{questions.map((q, i) => {
									const hasAnswer = !!getAnswerForQuestion(i)
									return (
										<button
											key={q.question}
											type="button"
											onClick={() => setTab(i)}
											className={cn(
												"flex h-6 w-6 items-center justify-center rounded-md text-xs font-medium transition-colors",
												tab === i
													? "bg-accent text-white"
													: hasAnswer
														? "bg-success/20 text-success"
														: "bg-surface-hover text-muted-foreground hover:text-foreground",
											)}
										>
											{i + 1}
										</button>
									)
								})}
							</div>
						)}
					</div>

					<div className="flex items-center gap-2">
						{/* Dismiss */}
						<button
							type="button"
							onClick={handleDismiss}
							disabled={submitting}
							className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							Dismiss
							<kbd className="rounded border border-border/60 bg-surface px-1 py-0.5 text-[10px] font-medium">
								ESC
							</kbd>
						</button>

						{/* Submit */}
						<button
							type="button"
							disabled={submitting || !canSubmit()}
							onClick={handleSubmit}
							className={cn(
								"flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
								canSubmit() && !submitting
									? "bg-accent text-white hover:bg-accent/90"
									: "bg-accent/30 text-white/50 cursor-not-allowed",
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
		</div>
	)
}

function SelectedCheck() {
	return (
		<svg
			className="h-4 w-4 shrink-0 text-accent"
			viewBox="0 0 16 16"
			fill="currentColor"
			role="img"
			aria-label="Selected"
		>
			<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
		</svg>
	)
}

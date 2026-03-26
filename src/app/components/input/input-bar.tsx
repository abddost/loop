import type { Agent } from "@core/schema/agent"
import type { ReasoningEffort } from "@core/schema/config"
import type { ProviderInfo } from "@core/schema/provider"
import { ArrowUp, Mic, Stop } from "@openai/apps-sdk-ui/components/Icon"
import { type KeyboardEvent, useCallback, useRef, useState } from "react"
import type { SessionUsage } from "../../stores/workspace-store"
import { cn } from "../ui/cn"
import { AgentSelector } from "./agent-selector"
import { AttachmentButton } from "./attachment-button"
import { ModelSelector } from "./model-selector"
import { ReasoningSelector } from "./reasoning-selector"
import { UsageBar } from "./usage-bar"

export interface InputBarProps {
	providers?: ProviderInfo[]
	selectedProviderId?: string
	selectedModelId?: string
	agents?: Agent[]
	selectedAgentName?: string
	onSubmit: (text: string) => void
	onAttach?: (files: FileList) => void
	onModelSelect?: (modelId: string, providerId: string) => void
	onAgentSelect?: (agentName: string) => void
	supportsReasoning?: boolean
	reasoningEffort?: ReasoningEffort
	onReasoningEffortChange?: (effort: ReasoningEffort) => void
	sessionUsage?: SessionUsage
	isStreaming?: boolean
	onInterrupt?: () => void
	disabled?: boolean
	placeholder?: string
	className?: string
}

/**
 * Main prompt input bar at the bottom of the chat.
 * Textarea on top, controls (attach, model, agent, send) on bottom row.
 */
export function InputBar({
	providers,
	selectedProviderId,
	selectedModelId,
	agents,
	selectedAgentName,
	onSubmit,
	onAttach,
	onModelSelect,
	onAgentSelect,
	supportsReasoning,
	reasoningEffort,
	onReasoningEffortChange,
	sessionUsage,
	isStreaming = false,
	onInterrupt,
	disabled = false,
	placeholder = "Ask for follow-up changes",
	className,
}: InputBarProps) {
	const [text, setText] = useState("")
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	const handleSubmit = useCallback(() => {
		const trimmed = text.trim()
		if (!trimmed || disabled) return
		onSubmit(trimmed)
		setText("")
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto"
		}
	}, [text, disabled, onSubmit])

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				handleSubmit()
			}
		},
		[handleSubmit],
	)

	const handleInput = useCallback(() => {
		const el = textareaRef.current
		if (!el) return
		el.style.height = "auto"
		el.style.height = `${Math.min(el.scrollHeight, 200)}px`
	}, [])

	return (
		<div className={cn("mx-auto w-full max-w-[52rem] px-12 pb-3 pt-2", className)}>
			<div className="rounded-xl border border-input-border bg-input-surface">
				{/* Textarea */}
				<div className="px-4 pt-3 pb-2">
					<textarea
						ref={textareaRef}
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={handleKeyDown}
						onInput={handleInput}
						placeholder={placeholder}
						disabled={disabled}
						rows={1}
						className="max-h-[200px] min-h-[24px] w-full resize-none bg-transparent text-sm text-foreground placeholder:text-placeholder focus:outline-none"
					/>
				</div>
				{/* Bottom controls row */}
				<div className="flex items-center justify-between px-3 py-1.5">
					<div className="flex items-center gap-1">
						{onAttach && <AttachmentButton onAttach={onAttach} />}
						{providers && onModelSelect && (
							<ModelSelector
								providers={providers}
								selectedProviderId={selectedProviderId}
								selectedModelId={selectedModelId}
								onSelect={onModelSelect}
								className="text-xs"
							/>
						)}
						{supportsReasoning && onReasoningEffortChange && (
							<ReasoningSelector
								value={reasoningEffort ?? "medium"}
								onChange={onReasoningEffortChange}
								className="text-xs"
							/>
						)}
						{agents && onAgentSelect && (
							<AgentSelector
								agents={agents}
								selectedAgentName={selectedAgentName}
								onSelect={onAgentSelect}
								className="text-xs"
							/>
						)}
					</div>
					<div className="flex items-center gap-1.5">
						<UsageBar usage={sessionUsage} />
						{/* Mic button */}
						<button
							type="button"
							className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground"
							aria-label="Voice input"
						>
							<Mic className="w-4 h-4" aria-hidden="true" />
						</button>
						{/* Stop / Send button */}
						{isStreaming ? (
							<button
								type="button"
								onClick={onInterrupt}
								className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger text-white transition-colors hover:bg-danger/90"
								aria-label="Stop"
							>
								<Stop className="w-3 h-3" aria-hidden="true" />
							</button>
						) : (
							<button
								type="button"
								onClick={handleSubmit}
								disabled={disabled || !text.trim()}
								className={cn(
									"flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
									text.trim()
										? "bg-foreground text-background hover:bg-foreground/90"
										: "border border-send-empty-border text-send-empty-text",
								)}
								aria-label="Send message"
							>
								<ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

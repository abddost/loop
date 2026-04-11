import type { Agent } from "@core/schema/agent"
import type { ReasoningEffort } from "@core/schema/config"
import type { ProviderInfo } from "@core/schema/provider"
import { ArrowUp, Stop } from "@openai/apps-sdk-ui/components/Icon"
import { type ClipboardEvent, type KeyboardEvent, useCallback, useRef, useState } from "react"
import { useFileAttachments } from "../../hooks/use-file-attachments"
import { classifyDroppedItems } from "../../lib/file-utils"
import type { SessionUsage } from "../../stores/workspace-store"
import { cn } from "../ui/cn"
import { AgentSelector } from "./agent-selector"
import { AttachmentButton } from "./attachment-button"
import { AttachmentPreview } from "./attachment-preview"
import { DragOverlay } from "./drag-overlay"
import { ModelSelector } from "./model-selector"
import { ReasoningSelector } from "./reasoning-selector"
import { UsageBar } from "./usage-bar"

export interface SubmitFiles {
	path: string
	mimeType: string
	content: string
}

export interface InputBarProps {
	providers?: ProviderInfo[]
	selectedProviderId?: string
	selectedModelId?: string
	agents?: Agent[]
	selectedAgentName?: string
	onSubmit: (text: string, files?: SubmitFiles[]) => void
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
 * Textarea on top, attachment preview, controls (attach, model, agent, send) on bottom row.
 * Supports file attachment via picker, drag-and-drop, and clipboard paste.
 */
export function InputBar({
	providers,
	selectedProviderId,
	selectedModelId,
	agents,
	selectedAgentName,
	onSubmit,
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
	const [isDragging, setIsDragging] = useState(false)
	const dragCounter = useRef(0)

	const { attachments, processing, addFiles, addFolder, removeAttachment, clearAttachments } =
		useFileAttachments()

	const hasContent = text.trim().length > 0 || attachments.length > 0

	const handleSubmit = useCallback(() => {
		const trimmed = text.trim()
		if ((!trimmed && attachments.length === 0) || disabled || processing) return

		const files =
			attachments.length > 0
				? attachments.map((a) => ({
						path: a.isFolder ? (a.folderPath ?? a.filename) : a.filename,
						mimeType: a.mimeType,
						content: a.dataUrl,
					}))
				: undefined

		onSubmit(trimmed, files)
		setText("")
		clearAttachments()
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto"
		}
	}, [text, attachments, disabled, processing, onSubmit, clearAttachments])

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

	const handlePaste = useCallback(
		(e: ClipboardEvent<HTMLTextAreaElement>) => {
			const items = Array.from(e.clipboardData.items)
			const fileItems = items.filter((item) => item.kind === "file")
			if (fileItems.length === 0) return

			e.preventDefault()
			const files = fileItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null)
			if (files.length > 0) {
				addFiles(files)
			}
		},
		[addFiles],
	)

	// Drag-and-drop: use a counter to handle nested elements firing enter/leave
	const handleDragEnter = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		dragCounter.current += 1
		if (e.dataTransfer.types.includes("Files")) {
			setIsDragging(true)
		}
	}, [])

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		dragCounter.current -= 1
		if (dragCounter.current === 0) {
			setIsDragging(false)
		}
	}, [])

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.dataTransfer.dropEffect = "copy"
	}, [])

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			e.preventDefault()
			dragCounter.current = 0
			setIsDragging(false)

			const { files, folders } = await classifyDroppedItems(e.dataTransfer)
			if (files.length > 0) addFiles(files)
			for (const folder of folders) addFolder(folder.name, folder.fullPath)
		},
		[addFiles, addFolder],
	)

	const handleAttach = useCallback(
		(files: FileList) => {
			addFiles(files)
		},
		[addFiles],
	)

	return (
		<div className={cn("mx-auto w-full max-w-[52rem] px-12 pb-3 pt-2", className)}>
			<div
				className="relative el-input-surface"
				onDragEnter={handleDragEnter}
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
			>
				<DragOverlay visible={isDragging} />
				{/* Attachment previews */}
				<AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
				{/* Textarea */}
				<div className="px-4 pt-3 pb-2">
					<textarea
						ref={textareaRef}
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={handleKeyDown}
						onInput={handleInput}
						onPaste={handlePaste}
						placeholder={placeholder}
						disabled={disabled}
						rows={1}
						className="max-h-[200px] min-h-[24px] w-full resize-none bg-transparent text-sm text-foreground placeholder:text-placeholder focus:outline-none"
					/>
				</div>
				{/* Bottom controls row */}
				<div className="flex items-center justify-between px-3 py-1.5">
					<div className="flex items-center gap-1">
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
						<AttachmentButton onAttach={handleAttach} />
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
								disabled={disabled || !hasContent || processing}
								className={cn(
									"flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
									hasContent
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

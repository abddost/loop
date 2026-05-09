import type { Agent } from "@core/schema/agent"
import type { ReasoningEffort } from "@core/schema/config"
import type { ModelInfo, ProviderInfo } from "@core/schema/provider"
import { ArrowUp, Stop } from "@openai/apps-sdk-ui/components/Icon"
import {
	type ClipboardEvent,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react"
import { useFileAttachments } from "../../hooks/use-file-attachments"
import { classifyDroppedItems } from "../../lib/file-utils"
import type { SessionUsage } from "../../stores/workspace-store"
import type { PermissionModeValue } from "../status-bar/permission-mode"
import { cn } from "../ui/cn"
import { AgentSelector } from "./agent-selector"
import { AttachmentButton } from "./attachment-button"
import { AttachmentPreview } from "./attachment-preview"
import { DragOverlay } from "./drag-overlay"
import { ModelSelector } from "./model-selector"
import { PermissionModeSelector } from "./permission-mode-selector"
import { type EffortLevel, ReasoningSelector } from "./reasoning-selector"
import { UsageBar } from "./usage-bar"

/** Human-readable labels for effort levels across providers. */
const EFFORT_LABELS: Record<string, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra High",
	max: "Max",
	ultrathink: "Ultrathink",
}
const EFFORT_SHORT_LABELS: Record<string, string> = {
	low: "Low",
	medium: "Med",
	high: "High",
	xhigh: "Extra High",
	max: "Max",
	ultrathink: "Ultra",
}

export interface SubmitFiles {
	path: string
	mimeType: string
	content: string
}

export interface InputBarProps {
	providers?: ProviderInfo[]
	selectedProviderId?: string
	selectedModelId?: string
	selectedModelInfo?: ModelInfo
	agents?: Agent[]
	selectedAgentName?: string
	onSubmit: (text: string, files?: SubmitFiles[]) => void
	onModelSelect?: (modelId: string, providerId: string) => void
	/** Navigate to the settings models tab (renders "Add Models" in the picker footer). */
	onManageModels?: () => void
	onAgentSelect?: (agentName: string) => void
	/** Whether to show the effort/reasoning selector. */
	hasEffortLevels?: boolean
	reasoningEffort?: ReasoningEffort
	onReasoningEffortChange?: (effort: ReasoningEffort) => void
	/** Whether the selected model is a Claude Code model. */
	isClaudeCode?: boolean
	/** Restrict the model picker to one provider (see ModelSelector). */
	lockedProviderId?: string
	/** Current permission mode (for Claude Code mode selector). */
	permissionMode?: PermissionModeValue
	onPermissionModeChange?: (mode: PermissionModeValue) => void
	sessionUsage?: SessionUsage
	isStreaming?: boolean
	onInterrupt?: () => void
	disabled?: boolean
	placeholder?: string
	className?: string
	/** Optional row rendered inside the surface below the controls, e.g. for project/branch selectors. */
	contextRow?: ReactNode
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
	selectedModelInfo,
	agents,
	selectedAgentName,
	onSubmit,
	onModelSelect,
	onManageModels,
	onAgentSelect,
	hasEffortLevels,
	reasoningEffort,
	onReasoningEffortChange,
	isClaudeCode,
	lockedProviderId,
	permissionMode,
	onPermissionModeChange,
	sessionUsage,
	isStreaming = false,
	onInterrupt,
	disabled = false,
	placeholder = "Ask anything, @ for context",
	className,
	contextRow,
}: InputBarProps) {
	const [text, setText] = useState("")
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const [isDragging, setIsDragging] = useState(false)
	const dragCounter = useRef(0)

	const { attachments, processing, addFiles, addFolder, removeAttachment, clearAttachments } =
		useFileAttachments()

	/** Derive effort level options from model capabilities. */
	const effortLevels = useMemo((): EffortLevel[] | undefined => {
		if (!selectedModelInfo?.effortLevels) return undefined
		const levels: EffortLevel[] = selectedModelInfo.effortLevels.map((v) => ({
			value: v as ReasoningEffort,
			label: EFFORT_LABELS[v] ?? v,
			short: EFFORT_SHORT_LABELS[v] ?? v,
		}))
		// Append prompt-injected effort levels (e.g. "ultrathink")
		if (selectedModelInfo.promptInjectedEffort) {
			for (const v of selectedModelInfo.promptInjectedEffort) {
				levels.push({
					value: v as ReasoningEffort,
					label: EFFORT_LABELS[v] ?? v,
					short: EFFORT_SHORT_LABELS[v] ?? v,
				})
			}
		}
		return levels
	}, [selectedModelInfo])

	const hasContent = text.trim().length > 0 || attachments.length > 0
	// Resolve against the same `providers` list the picker renders from (which
	// is already filtered by enabledModels in useSessionPage). selectedModelInfo
	// is computed from the unfiltered store, so it can stay truthy after the
	// user disables a model in settings — leaving the picker on "Select model"
	// while sending stays enabled. Mirroring the picker's resolution keeps the
	// gate in lockstep with what the user actually sees.
	const hasModel = useMemo(() => {
		if (!providers || !selectedProviderId || !selectedModelId) return false
		const provider = providers.find((p) => p.id === selectedProviderId)
		return !!provider?.models.some((m) => m.id === selectedModelId)
	}, [providers, selectedProviderId, selectedModelId])

	const handleSubmit = useCallback(() => {
		const trimmed = text.trim()
		if ((!trimmed && attachments.length === 0) || disabled || processing || !hasModel) return

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
	}, [text, attachments, disabled, processing, hasModel, onSubmit, clearAttachments])

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
				<div className="px-5 pt-4 pb-2.5">
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
						className="max-h-[200px] min-h-[32px] w-full resize-none bg-transparent text-base text-foreground placeholder:text-placeholder focus:outline-none"
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
								onManageModels={onManageModels}
								lockedProviderId={lockedProviderId}
								className="text-xs"
							/>
						)}
						{hasEffortLevels && onReasoningEffortChange && (
							<ReasoningSelector
								value={reasoningEffort ?? "medium"}
								onChange={onReasoningEffortChange}
								levels={effortLevels}
								className="text-xs"
							/>
						)}
						{isClaudeCode && permissionMode && onPermissionModeChange ? (
							<PermissionModeSelector
								value={permissionMode}
								onChange={onPermissionModeChange}
								className="text-xs"
							/>
						) : (
							agents &&
							onAgentSelect && (
								<AgentSelector
									agents={agents}
									selectedAgentName={selectedAgentName}
									onSelect={onAgentSelect}
									className="text-xs"
								/>
							)
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
								disabled={disabled || !hasContent || processing || !hasModel}
								title={!hasModel ? "Select a model first" : undefined}
								className={cn(
									"flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
									hasContent && hasModel
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
				{contextRow && <div className="border-t border-[var(--separator)]">{contextRow}</div>}
			</div>
		</div>
	)
}

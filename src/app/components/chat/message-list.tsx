import type { EditPart, MessageWithParts } from "@core/schema"
import { ChevronDown } from "@openai/apps-sdk-ui/components/Icon"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react"
import { useConfigStore } from "../../stores/config-store"
import { cn } from "../ui/cn"
import { mergeExplorationMessages } from "./context-tool-group"
import { EditDiff } from "./edit-diff"
import { MessageItem } from "./message-item"

export interface MessageListHandle {
	scrollToIndex: (index: number) => void
}

export interface MessageListProps {
	sessionId: string
	messages: MessageWithParts[]
	isStreaming?: boolean
	isCompacting?: boolean
	onUndo?: (hash: string) => void
	className?: string
}

/**
 * Virtualized message list using @tanstack/react-virtual.
 * Auto-scrolls to bottom on new messages and during streaming.
 * Shows a scroll-to-bottom button when the user scrolls up.
 */
export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(
	{ sessionId, messages, isStreaming = false, isCompacting = false, onUndo, className },
	ref,
) {
	const parentRef = useRef<HTMLDivElement>(null)
	const [userScrolledUp, setUserScrolledUp] = useState(false)

	// Chat display visibility — filter reasoning and/or tool parts before
	// grouping. Filtering at this layer keeps both standalone rows AND
	// parts inside expanded groups gone in one step.
	// Tools are always visible during streaming regardless of the setting;
	// once streaming ends they hide by default until the user toggles them.
	const showReasoning = useConfigStore((s) => s.config.reasoning.showInChat)
	const showTools = useConfigStore((s) => s.config.tools.showInChat)
	const filteredMessages = useMemo(() => {
		const hideReasoning = !showReasoning
		const hideTools = !isStreaming && !showTools
		if (!hideReasoning && !hideTools) return messages
		return messages.map((m) => ({
			...m,
			parts: m.parts.filter((p) => {
				if (hideReasoning && p.type === "reasoning") return false
				if (hideTools && p.type === "tool") return false
				return true
			}),
		}))
	}, [messages, showReasoning, showTools, isStreaming])

	// Merge consecutive exploration-only messages into a single "Explored" group
	const displayMessages = useMemo(
		() => mergeExplorationMessages(filteredMessages),
		[filteredMessages],
	)

	// Collect all edit parts across the session for the accumulated view
	const allEditParts = useMemo(() => {
		const edits: EditPart[] = []
		for (const msg of messages) {
			for (const part of msg.parts) {
				if (part.type === "edit") edits.push(part)
			}
		}
		return edits
	}, [messages])

	const virtualizer = useVirtualizer({
		count: displayMessages.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 100,
		overscan: 5,
	})

	useImperativeHandle(ref, () => ({
		scrollToIndex: (index: number) =>
			virtualizer.scrollToIndex(index, { align: "start", behavior: "smooth" }),
	}))

	// Auto-scroll on new messages unless user scrolled up
	useEffect(() => {
		if (!userScrolledUp && displayMessages.length > 0) {
			virtualizer.scrollToIndex(displayMessages.length - 1, { align: "end" })
		}
	}, [userScrolledUp, displayMessages.length, virtualizer])

	// Continuous auto-scroll during streaming via ResizeObserver
	useEffect(() => {
		if (!isStreaming || userScrolledUp) return

		const el = parentRef.current
		if (!el) return
		const inner = el.firstElementChild
		if (!inner) return

		const observer = new ResizeObserver(() => {
			el.scrollTop = el.scrollHeight
		})
		observer.observe(inner)

		return () => observer.disconnect()
	}, [isStreaming, userScrolledUp])

	// Track user scroll position
	const handleScroll = useCallback(() => {
		const el = parentRef.current
		if (!el) return
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
		setUserScrolledUp(!atBottom)
	}, [])

	const handleScrollToBottom = useCallback(() => {
		const el = parentRef.current
		if (!el) return
		// Don't set userScrolledUp(false) immediately — that would reconnect
		// the ResizeObserver (during streaming) which does an instant scrollTop
		// assignment, canceling the smooth animation. The onScroll handler will
		// detect arrival at bottom and clear the flag naturally.
		el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
	}, [])

	const lastAssistantIdx =
		displayMessages.length -
		1 -
		[...displayMessages].reverse().findIndex((m) => m.role === "assistant")

	return (
		// min-h-0 is critical: overrides flexbox default min-height:auto so this
		// flex child can shrink and the inner scroll container gets a bounded height.
		<div className={cn("relative min-h-0", className)}>
			<div ref={parentRef} onScroll={handleScroll} className="h-full overflow-auto pb-8">
				<div
					style={{
						height: `${virtualizer.getTotalSize()}px`,
						width: "100%",
						position: "relative",
					}}
				>
					{virtualizer.getVirtualItems().map((virtualItem) => {
						const message = displayMessages[virtualItem.index]
						return (
							<div
								key={virtualItem.key}
								data-index={virtualItem.index}
								ref={virtualizer.measureElement}
								style={{
									position: "absolute",
									top: 0,
									left: 0,
									width: "100%",
									transform: `translateY(${virtualItem.start}px)`,
								}}
							>
								<MessageItem
									message={message}
									isLastAssistant={virtualItem.index === lastAssistantIdx}
									isStreaming={isStreaming && virtualItem.index === lastAssistantIdx}
								/>
							</div>
						)
					})}
				</div>
				{allEditParts.length > 0 && !isStreaming && (
					<div className="mx-auto max-w-[52rem] px-12 py-3">
						<EditDiff sessionId={sessionId} parts={allEditParts} onUndo={onUndo} />
					</div>
				)}
				{isCompacting && (
					<div className="mx-auto max-w-[52rem] px-12 py-3">
						<span className="shimmer-text text-sm">Compacting conversation...</span>
					</div>
				)}
			</div>

			{userScrolledUp && (
				<button
					type="button"
					onClick={handleScrollToBottom}
					className="absolute bottom-6 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border/60 bg-surface shadow-lg transition-all hover:bg-surface-hover active:scale-95"
					aria-label="Scroll to bottom"
				>
					<ChevronDown className="h-4 w-4" aria-hidden="true" />
				</button>
			)}
		</div>
	)
})

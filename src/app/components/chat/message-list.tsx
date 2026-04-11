import type { EditPart, MessageWithParts } from "@core/schema"
import { ChevronDown } from "@openai/apps-sdk-ui/components/Icon"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "../ui/cn"
import { mergeExplorationMessages } from "./context-tool-group"
import { EditDiff } from "./edit-diff"
import { MessageItem } from "./message-item"

export interface MessageListProps {
	messages: MessageWithParts[]
	isStreaming?: boolean
	isCompacting?: boolean
	onUndo?: (hash: string) => void
	className?: string
}

/**
 * Auto-scroll distance threshold.
 * The ResizeObserver callback scrolls to bottom only if the user
 * is within this distance from the bottom. Generous value avoids
 * a race where content grows between the position check and the
 * scroll assignment, which would falsely disable auto-scroll.
 */
const AUTO_SCROLL_THRESHOLD = 300

/**
 * Virtualized message list using @tanstack/react-virtual.
 * Auto-scrolls to bottom on new messages and during streaming.
 * Shows a scroll-to-bottom button when the user scrolls up.
 */
export function MessageList({
	messages,
	isStreaming = false,
	isCompacting = false,
	onUndo,
	className,
}: MessageListProps) {
	const parentRef = useRef<HTMLDivElement>(null)
	const [userScrolledUp, setUserScrolledUp] = useState(false)

	// Merge consecutive exploration-only messages into a single "Explored" group
	const displayMessages = useMemo(() => mergeExplorationMessages(messages), [messages])

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

	// Auto-scroll on new messages unless user scrolled up
	useEffect(() => {
		if (!userScrolledUp && displayMessages.length > 0) {
			virtualizer.scrollToIndex(displayMessages.length - 1, { align: "end" })
		}
	}, [userScrolledUp, displayMessages.length, virtualizer])

	// Continuous auto-scroll during streaming via ResizeObserver.
	// IMPORTANT: depends ONLY on isStreaming — NOT userScrolledUp.
	// Using userScrolledUp as a dependency creates a race condition:
	// content can grow between the observer's scroll assignment and
	// the onScroll handler check, causing userScrolledUp to flip true
	// and disconnect the observer permanently for that streaming session.
	// Instead, the callback checks scroll position directly.
	useEffect(() => {
		if (!isStreaming) return

		const el = parentRef.current
		if (!el) return
		const inner = el.firstElementChild
		if (!inner) return

		const observer = new ResizeObserver(() => {
			const gap = el.scrollHeight - el.scrollTop - el.clientHeight
			if (gap < AUTO_SCROLL_THRESHOLD) {
				el.scrollTop = el.scrollHeight
			}
		})
		observer.observe(inner)

		return () => observer.disconnect()
	}, [isStreaming])

	// Track user scroll position (for scroll-to-bottom button)
	const handleScroll = useCallback(() => {
		const el = parentRef.current
		if (!el) return
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
		setUserScrolledUp(!atBottom)
	}, [])

	const handleScrollToBottom = useCallback(() => {
		const el = parentRef.current
		if (!el) return
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
				{!isStreaming && allEditParts.length > 0 && (
					<div className="mx-auto max-w-[52rem] px-12 py-3">
						<EditDiff parts={allEditParts} onUndo={onUndo} />
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
					className="absolute bottom-6 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-surface shadow-[var(--shadow-card)] transition-all hover:bg-surface-hover active:scale-95"
					aria-label="Scroll to bottom"
				>
					<ChevronDown className="h-4 w-4" aria-hidden="true" />
				</button>
			)}
		</div>
	)
}

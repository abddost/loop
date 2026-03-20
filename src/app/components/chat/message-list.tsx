import type { MessageWithParts } from "@core/schema"
import { ChevronDownIcon } from "@heroicons/react/24/outline"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "../ui/cn"
import { MessageItem } from "./message-item"

export interface MessageListProps {
	messages: MessageWithParts[]
	isStreaming?: boolean
	onUndo?: (hash: string) => void
	className?: string
}

/**
 * Virtualized message list using @tanstack/react-virtual.
 * Auto-scrolls to bottom on new messages and during streaming.
 * Shows a scroll-to-bottom button when the user scrolls up.
 */
export function MessageList({
	messages,
	isStreaming = false,
	onUndo,
	className,
}: MessageListProps) {
	const parentRef = useRef<HTMLDivElement>(null)
	const [userScrolledUp, setUserScrolledUp] = useState(false)

	const virtualizer = useVirtualizer({
		count: messages.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 100,
		overscan: 5,
	})

	// Auto-scroll on new messages unless user scrolled up
	useEffect(() => {
		if (!userScrolledUp && messages.length > 0) {
			virtualizer.scrollToIndex(messages.length - 1, { align: "end" })
		}
	}, [userScrolledUp, messages.length, virtualizer])

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
		messages.length - 1 - [...messages].reverse().findIndex((m) => m.role === "assistant")

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
						const message = messages[virtualItem.index]
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
									onUndo={onUndo}
								/>
							</div>
						)
					})}
				</div>
			</div>

			{userScrolledUp && (
				<button
					type="button"
					onClick={handleScrollToBottom}
					className="absolute bottom-6 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border/60 bg-surface shadow-lg transition-all hover:bg-surface-hover active:scale-95"
					aria-label="Scroll to bottom"
				>
					<ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
				</button>
			)}
		</div>
	)
}

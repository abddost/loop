import type { MessageWithParts } from "@core/schema"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useCallback, useEffect, useRef, useState } from "react"
import { MessageItem } from "./message-item"

export interface MessageListProps {
	messages: MessageWithParts[]
	isStreaming?: boolean
	onUndo?: (hash: string) => void
	className?: string
}

/**
 * Virtualized message list using @tanstack/react-virtual.
 * Auto-scrolls to bottom on new messages, with scroll lock when user scrolls up.
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

	const scrollToBottom = useCallback(() => {
		if (messages.length > 0) {
			virtualizer.scrollToIndex(messages.length - 1, { align: "end" })
		}
	}, [messages.length, virtualizer])

	// Auto-scroll on new messages unless user scrolled up
	useEffect(() => {
		if (!userScrolledUp) {
			scrollToBottom()
		}
	}, [userScrolledUp, scrollToBottom])

	// Track user scroll position
	const handleScroll = useCallback(() => {
		const el = parentRef.current
		if (!el) return
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
		setUserScrolledUp(!atBottom)
	}, [])

	const lastAssistantIdx =
		messages.length - 1 - [...messages].reverse().findIndex((m) => m.role === "assistant")

	return (
		<div
			ref={parentRef}
			className={className}
			onScroll={handleScroll}
			style={{ overflow: "auto", height: "100%" }}
		>
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
	)
}

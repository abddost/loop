import type { MessageWithParts } from "@core/schema"
import { cn } from "../ui/cn"
import { PartRenderer } from "./part-renderer"

export interface MessageItemProps {
	message: MessageWithParts
	isLastAssistant?: boolean
	isStreaming?: boolean
	onUndo?: (hash: string) => void
	className?: string
}

/**
 * Single message renderer.
 * User messages display as right-aligned bubbles; assistant messages render parts.
 */
export function MessageItem({ message, isStreaming = false, onUndo, className }: MessageItemProps) {
	const isUser = message.role === "user"

	return (
		<div
			className={cn("mx-auto w-full max-w-4xl px-12 py-4", isUser && "flex justify-end", className)}
		>
			{isUser ? (
				<div className="max-w-[75%] space-y-2">
					{message.parts.map((part, i) => (
						<div key={`${message.id}-${i}`}>
							{part.type === "text" ? (
								<div className="rounded-2xl bg-bubble-user px-5 py-3 text-sm leading-relaxed text-foreground">
									{part.text}
								</div>
							) : (
								<PartRenderer part={part} />
							)}
						</div>
					))}
				</div>
			) : (
				<div className="max-w-full space-y-3">
					{message.parts.map((part, i) => {
						const isLastPart = i === message.parts.length - 1
						return (
							<div key={`${message.id}-${i}`}>
								<PartRenderer part={part} isStreaming={isStreaming && isLastPart} onUndo={onUndo} />
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}

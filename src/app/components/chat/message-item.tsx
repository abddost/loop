import { useCallback, useState } from "react"
import type { MessageWithParts } from "../../stores/workspace-store"
import { cn } from "../ui/cn"
import { PartRenderer } from "./part-renderer"

export interface MessageItemProps {
	message: MessageWithParts
	isLastAssistant?: boolean
	isStreaming?: boolean
	onUndo?: (hash: string) => void
	className?: string
}

function getMessageText(message: MessageWithParts): string {
	return message.parts
		.filter((p) => p.type === "text")
		.map((p) => p.text)
		.join("\n")
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}, [text])

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
			title={copied ? "Copied!" : "Copy"}
			aria-label="Copy message"
		>
			{copied ? (
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<polyline points="20 6 9 17 4 12" />
				</svg>
			) : (
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<rect x="9" y="9" width="13" height="13" rx="2" />
					<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
				</svg>
			)}
		</button>
	)
}

/**
 * Single message renderer.
 * User messages display as right-aligned bubbles; assistant messages render parts.
 * A footer row with duration + copy button appears on hover (only if text content exists).
 */
export function MessageItem({ message, isStreaming = false, onUndo, className }: MessageItemProps) {
	const isUser = message.role === "user"
	const textContent = getMessageText(message)

	return (
		<div
			className={cn(
				"group/msg mx-auto w-full max-w-4xl px-12 py-4",
				isUser && "flex justify-end",
				className,
			)}
		>
			{isUser ? (
				<div className="max-w-[75%] space-y-2">
					{message.parts.map((part, i) => (
						<div key={part.id ?? `${message.id}-${i}`}>
							{part.type === "text" ? (
								<div className="rounded-2xl bg-bubble-user px-5 py-3 text-sm leading-relaxed text-foreground">
									{part.text}
								</div>
							) : (
								<PartRenderer part={part} partId={part.id} />
							)}
						</div>
					))}
					<div className="flex justify-end opacity-0 transition-opacity group-hover/msg:opacity-100">
						<CopyButton text={textContent} />
					</div>
				</div>
			) : (
				<div className="max-w-full space-y-3">
					{message.parts.map((part, i) => {
						const isLastPart = i === message.parts.length - 1
						return (
							<div key={part.id ?? `${message.id}-${i}`}>
								<PartRenderer
									part={part}
									partId={part.id}
									isStreaming={isStreaming && (isLastPart || part.streaming === true)}
									onUndo={onUndo}
								/>
							</div>
						)
					})}
					{textContent.trim() && (
						<div className="flex items-center gap-2 opacity-0 transition-opacity group-hover/msg:opacity-100">
							<CopyButton text={textContent} />
						</div>
					)}
				</div>
			)}
		</div>
	)
}

import { Check, Copy } from "@openai/apps-sdk-ui/components/Icon"
import { memo, useCallback, useMemo, useState } from "react"
import type { MessageWithParts } from "../../stores/workspace-store"
import { cn } from "../ui/cn"
import { Tooltip } from "../ui/tooltip"
import { ContextToolGroup, segmentParts } from "./context-tool-group"
import { PartRenderer } from "./part-renderer"

export interface MessageItemProps {
	message: MessageWithParts
	isLastAssistant?: boolean
	isStreaming?: boolean
	className?: string
}

function getMessageText(message: MessageWithParts): string {
	return message.parts
		.filter((p) => p.type === "text")
		.map((p) => p.text)
		.join("\n")
}

/** Whether a message has user-facing text content worth copying.
 *  System events (compaction markers, etc.) are excluded. */
function hasCopyableContent(message: MessageWithParts): boolean {
	if (message.parts.some((p) => p.type === "compaction")) return false
	return message.parts.some((p) => p.type === "text" && p.text.trim())
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
		<Tooltip content={copied ? "Copied!" : "Copy"}>
			<button
				type="button"
				onClick={handleCopy}
				className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
				aria-label="Copy message"
			>
				{copied ? (
					<Check className="h-3.5 w-3.5" aria-hidden="true" />
				) : (
					<Copy className="h-3.5 w-3.5" aria-hidden="true" />
				)}
			</button>
		</Tooltip>
	)
}

/**
 * Renders assistant message parts.
 *
 * Single source of truth for which parts collapse into a Work-Log
 * summary vs. render standalone is `segmentParts` — text and the
 * edit-aggregator stay first-class, every consecutive run of work
 * parts that contains at least one tool collapses into a single
 * chevron-line summary. There is intentionally no whole-message
 * wrapper path: that one shortcut used to hide text parts inside the
 * group when the message had a mix of text + tools.
 */
const GroupedParts = memo(function GroupedParts({
	message,
	isStreaming,
}: {
	message: MessageWithParts
	isStreaming: boolean
}) {
	const segments = useMemo(() => segmentParts(message.parts), [message.parts])

	const lastPartIndex = message.parts.length - 1
	return (
		<>
			{segments.map((seg) => {
				if (seg.kind === "group") {
					return (
						<div key={`group-${seg.startIndex}`} className={isStreaming ? "part-enter" : undefined}>
							<ContextToolGroup parts={seg.parts} isStreaming={isStreaming} />
						</div>
					)
				}
				const { index } = seg
				// Use the message's part directly to preserve runtime fields (id, streaming)
				const part = message.parts[index]
				return (
					<div
						key={part.id ?? `${message.id}-${index}`}
						className={isStreaming ? "part-enter" : undefined}
					>
						<PartRenderer
							part={part}
							partId={part.id}
							isStreaming={isStreaming && (index === lastPartIndex || part.streaming === true)}
						/>
					</div>
				)
			})}
		</>
	)
})

/**
 * Single message renderer.
 * User messages display as right-aligned bubbles; assistant messages render parts.
 * A footer row with duration + copy button appears on hover (only if text content exists).
 *
 * Memoized: when a part in a *different* message changes, immer preserves this
 * message's object reference so memo correctly skips the re-render.
 */
export const MessageItem = memo(function MessageItem({
	message,
	isLastAssistant = false,
	isStreaming = false,
	className,
}: MessageItemProps) {
	const isUser = message.role === "user"
	const textContent = getMessageText(message)

	return (
		<div
			className={cn(
				"group/msg mx-auto w-full max-w-[52rem] px-12",
				isUser ? "py-2" : "py-0.5",
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
				<div className="max-w-full space-y-1">
					<GroupedParts message={message} isStreaming={isStreaming} />
					{isLastAssistant && hasCopyableContent(message) && (
						<div className="flex items-center gap-2 opacity-0 transition-opacity group-hover/msg:opacity-100">
							<CopyButton text={textContent} />
						</div>
					)}
				</div>
			)}
		</div>
	)
})

import type { ReasoningPart } from "@core/schema"
import { useState } from "react"
import Markdown from "react-markdown"
import { useStreamingText } from "../../hooks/use-streaming-text"
import { cn } from "../ui/cn"

export interface ThinkingIndicatorProps {
	part: ReasoningPart
	partId?: string
	isStreaming?: boolean
	className?: string
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = seconds % 60
	if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
	return `${seconds}s`
}

const markdownComponents = {
	p({ children, ...props }: React.ComponentPropsWithoutRef<"p">) {
		return (
			<p className="mb-3 last:mb-0" {...props}>
				{children}
			</p>
		)
	},
	ul({ children, ...props }: React.ComponentPropsWithoutRef<"ul">) {
		return (
			<ul className="my-2 list-disc space-y-1 pl-5" {...props}>
				{children}
			</ul>
		)
	},
	ol({ children, ...props }: React.ComponentPropsWithoutRef<"ol">) {
		return (
			<ol className="my-2 list-decimal space-y-1 pl-5" {...props}>
				{children}
			</ol>
		)
	},
	li({ children, ...props }: React.ComponentPropsWithoutRef<"li">) {
		return (
			<li className="leading-relaxed" {...props}>
				{children}
			</li>
		)
	},
	code({ children, className: codeClassName, ...props }: React.ComponentPropsWithoutRef<"code">) {
		const isInline = !codeClassName
		if (isInline) {
			return (
				<code className="rounded bg-code-inline px-1 py-0.5 text-[12px] font-mono" {...props}>
					{children}
				</code>
			)
		}
		return (
			<code className={codeClassName} {...props}>
				{children}
			</code>
		)
	},
	pre({ children, ...props }: React.ComponentPropsWithoutRef<"pre">) {
		return (
			<pre
				className="my-2 overflow-x-auto rounded-lg bg-code-block p-3 text-xs leading-5"
				{...props}
			>
				{children}
			</pre>
		)
	},
}

/**
 * Renders reasoning/thinking content.
 *
 * Streaming: shimmer "Thinking" label with toggle arrow to reveal live reasoning text.
 * Done: "Thought for Xs" (no shimmer) with toggle arrow; reasoning text at low opacity with markdown.
 */
export function ThinkingIndicator({
	part,
	partId,
	isStreaming = false,
	className,
}: ThinkingIndicatorProps) {
	const [expanded, setExpanded] = useState(false)
	const streamingText = useStreamingText(isStreaming && partId ? partId : null)

	if (isStreaming) {
		const displayText = streamingText ?? part.text
		return (
			<div className={cn("space-y-0.5", className)}>
				<button
					type="button"
					className="flex items-center gap-1.5 text-sm"
					onClick={() => setExpanded(!expanded)}
				>
					<span className="shimmer-text font-medium">Thinking</span>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className={cn("text-muted transition-transform duration-200", expanded && "rotate-180")}
						aria-hidden="true"
					>
						<polyline points="6 9 12 15 18 9" />
					</svg>
				</button>
				<div
					className="grid transition-[grid-template-rows] duration-200 ease-out"
					style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
				>
					<div className="min-h-0 overflow-hidden">
						{displayText && (
							<div className="max-h-40 overflow-y-auto pt-1 text-xs leading-relaxed text-muted-foreground/50">
								<Markdown components={markdownComponents}>{displayText}</Markdown>
							</div>
						)}
					</div>
				</div>
			</div>
		)
	}

	if (!part.text) return null

	const duration = part.time ? part.time.end - part.time.start : null
	const label = duration !== null ? `Thought for ${formatDuration(duration)}` : "Thought"

	return (
		<div className={cn("space-y-0.5", className)}>
			<button
				type="button"
				className="flex items-center gap-1.5 text-sm text-muted-foreground/70"
				onClick={() => setExpanded(!expanded)}
			>
				<span className="font-medium">{label}</span>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					className={cn("transition-transform duration-200", expanded && "rotate-180")}
					aria-hidden="true"
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>
			<div
				className="grid transition-[grid-template-rows] duration-200 ease-out"
				style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="max-h-64 overflow-y-auto pt-1 text-xs leading-relaxed text-muted-foreground/50">
						<Markdown components={markdownComponents}>{part.text}</Markdown>
					</div>
				</div>
			</div>
		</div>
	)
}

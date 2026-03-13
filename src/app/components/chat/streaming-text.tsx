import Markdown from "react-markdown"
import { cn } from "../ui/cn"

export interface StreamingTextProps {
	text: string
	isStreaming?: boolean
	className?: string
}

/**
 * Renders assistant text as markdown with an animated streaming cursor when active.
 */
export function StreamingText({ text, isStreaming = false, className }: StreamingTextProps) {
	return (
		<div className={cn("text-[14px] leading-[1.7] text-foreground", className)}>
			<Markdown
				components={{
					pre({ children, ...props }) {
						return (
							<pre
								className="my-3 overflow-x-auto rounded-lg bg-code-block p-4 text-xs leading-5"
								{...props}
							>
								{children}
							</pre>
						)
					},
					code({ children, className: codeClassName, ...props }) {
						const isInline = !codeClassName
						if (isInline) {
							return (
								<code
									className="rounded bg-code-inline px-1.5 py-0.5 text-[13px] font-mono text-foreground"
									{...props}
								>
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
					a({ children, ...props }) {
						return (
							<a
								className="text-accent underline underline-offset-2 hover:text-accent/80"
								target="_blank"
								rel="noopener noreferrer"
								{...props}
							>
								{children}
							</a>
						)
					},
					ul({ children, ...props }) {
						return (
							<ul className="my-3 list-disc space-y-2 pl-6" {...props}>
								{children}
							</ul>
						)
					},
					ol({ children, ...props }) {
						return (
							<ol className="my-3 list-decimal space-y-2 pl-6" {...props}>
								{children}
							</ol>
						)
					},
					p({ children, ...props }) {
						return (
							<p className="mb-4 last:mb-0" {...props}>
								{children}
							</p>
						)
					},
					li({ children, ...props }) {
						return (
							<li className="leading-[1.7]" {...props}>
								{children}
							</li>
						)
					},
				}}
			>
				{text}
			</Markdown>
			{isStreaming && (
				<span
					className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent"
					aria-hidden="true"
				/>
			)}
		</div>
	)
}

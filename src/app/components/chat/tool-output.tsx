import { cn } from "../ui/cn"

export interface ToolOutputProps {
	output: string
	className?: string
}

/**
 * Rendered tool output with monospace formatting.
 * Displays output text in a code-style block.
 */
export function ToolOutput({ output, className }: ToolOutputProps) {
	if (!output) return null

	return (
		<pre
			className={cn(
				"max-h-64 overflow-auto rounded-[--radius-sm] bg-background p-3 text-xs text-muted-foreground",
				"[&::-webkit-scrollbar]:w-1.5",
				"[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
				className,
			)}
		>
			<code>{output}</code>
		</pre>
	)
}

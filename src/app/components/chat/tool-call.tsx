import type { ToolPart } from "@core/schema"
import { useState } from "react"
import { cn } from "../ui/cn"
import { ToolOutput } from "./tool-output"

export interface ToolCallProps {
	part: ToolPart
	className?: string
}

function getToolTitle(part: ToolPart): string {
	const name = part.tool
	const input = part.input

	if (name === "bash" && input?.command) {
		const cmd = String(input.command).split("\n")[0].slice(0, 60)
		return `Ran bash: ${cmd}`
	}
	if ((name === "read" || name === "Read") && input?.file_path) {
		return `Read: ${String(input.file_path)}`
	}
	if ((name === "write" || name === "Write") && input?.file_path) {
		return `Write: ${String(input.file_path)}`
	}
	if ((name === "edit" || name === "Edit") && input?.file_path) {
		return `Edit: ${String(input.file_path)}`
	}
	return name
}

const stateIcons: Record<ToolPart["state"], string> = {
	pending: "\u23F3",
	running: "\u25B6",
	completed: "\u2713",
	error: "\u2717",
}

const stateColors: Record<ToolPart["state"], string> = {
	pending: "text-muted",
	running: "text-accent",
	completed: "text-success",
	error: "text-error",
}

/**
 * Collapsible tool call display.
 * Shows tool name + status icon in header, expandable body with input/output.
 */
export function ToolCall({ part, className }: ToolCallProps) {
	const [expanded, setExpanded] = useState(false)
	const title = getToolTitle(part)

	return (
		<div className={cn("rounded-[--radius-md] border border-border", className)}>
			<button
				type="button"
				className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
				onClick={() => setExpanded(!expanded)}
			>
				<span className={cn("shrink-0 text-xs", stateColors[part.state])}>
					{part.state === "running" ? (
						<span className="inline-block animate-spin">{stateIcons.running}</span>
					) : (
						stateIcons[part.state]
					)}
				</span>
				<span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
				<span
					className={cn(
						"shrink-0 text-xs text-muted transition-transform",
						expanded && "rotate-90",
					)}
					aria-hidden="true"
				>
					{"\u25B6"}
				</span>
			</button>
			{expanded && (
				<div className="border-t border-border px-3 py-2 space-y-2">
					{part.input && (
						<pre className="max-h-48 overflow-auto rounded-[--radius-sm] bg-background p-2 text-xs text-muted-foreground">
							<code>{JSON.stringify(part.input, null, 2)}</code>
						</pre>
					)}
					{part.output && <ToolOutput output={part.output} />}
					{part.error && (
						<div className="rounded-[--radius-sm] bg-error/10 p-2 text-xs text-error">
							{part.error}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

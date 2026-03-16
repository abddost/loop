import { useMemo } from "react"
import { cn } from "../ui/cn"

export interface ToolOutputProps {
	output: string
	className?: string
}

// ─── ANSI stripping ─────────────────────────────────────────────

// Matches CSI sequences, OSC sequences, and single-char ESC sequences
const ANSI_RE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI stripping
	/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g

export function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "")
}

// ─── DiffBlock ──────────────────────────────────────────────────

export interface DiffBlockProps {
	diff: string
	className?: string
}

/**
 * Render a unified diff with syntax coloring.
 * - Lines starting with `+` (but not `+++`) -> green (added)
 * - Lines starting with `-` (but not `---`) -> red (removed)
 * - Lines starting with `@@` -> hunk header (blue)
 * - `---` and `+++` -> file header
 * - Other lines -> neutral context
 */
export function DiffBlock({ diff, className }: DiffBlockProps) {
	const lines = useMemo(() => diff.split("\n"), [diff])

	return (
		<pre
			className={cn(
				"max-h-80 overflow-auto rounded-lg bg-background/80 p-2.5 text-xs leading-5 font-mono",
				"[&::-webkit-scrollbar]:w-1.5",
				"[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
				className,
			)}
		>
			<code>
				{lines.map((line, i) => {
					const key = `${i}-${line.length}`
					if (line.startsWith("@@")) {
						return (
							<div key={key} className="text-accent/70">
								{line}
							</div>
						)
					}
					if (line.startsWith("---") || line.startsWith("+++")) {
						return (
							<div key={key} className="text-muted-foreground/70 font-semibold">
								{line}
							</div>
						)
					}
					if (line.startsWith("+")) {
						return (
							<div key={key} className="bg-success/10 text-success">
								{line}
							</div>
						)
					}
					if (line.startsWith("-")) {
						return (
							<div key={key} className="bg-error/10 text-error">
								{line}
							</div>
						)
					}
					return (
						<div key={key} className="text-muted-foreground">
							{line}
						</div>
					)
				})}
			</code>
		</pre>
	)
}

// ─── StatusIcon ─────────────────────────────────────────────────

export type ToolState = "pending" | "running" | "completed" | "error"

export interface StatusIconProps {
	state: ToolState
	className?: string
}

/** Shared status indicator: spinner for pending/running, check for completed, X for error. */
export function StatusIcon({ state, className }: StatusIconProps) {
	if (state === "pending" || state === "running") {
		return (
			<svg
				className={cn("h-3.5 w-3.5 animate-spin", className)}
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="10" stroke="var(--border)" strokeWidth="2.5" />
				<circle
					cx="12"
					cy="12"
					r="10"
					stroke="var(--accent)"
					strokeWidth="2.5"
					strokeDasharray="62.83"
					strokeDashoffset="47.12"
					strokeLinecap="round"
				/>
			</svg>
		)
	}

	if (state === "completed") {
		return (
			<svg
				className={cn("h-3.5 w-3.5 text-success", className)}
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
		)
	}

	// error
	return (
		<svg
			className={cn("h-3.5 w-3.5 text-error", className)}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	)
}

// ─── ToolOutput (plain monospace block) ─────────────────────────

/**
 * Rendered tool output with monospace formatting.
 * Strips ANSI escape codes and displays output in a scrollable code block.
 */
export function ToolOutput({ output, className }: ToolOutputProps) {
	if (!output) return null

	const cleaned = useMemo(() => stripAnsi(output), [output])

	return (
		<pre
			className={cn(
				"max-h-64 overflow-auto rounded-lg bg-background/80 p-3 text-xs text-muted-foreground font-mono",
				"[&::-webkit-scrollbar]:w-1.5",
				"[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
				className,
			)}
		>
			<code>{cleaned}</code>
		</pre>
	)
}

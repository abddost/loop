import { CheckCircleFilled, CircleDashed, XCircleFilled } from "@openai/apps-sdk-ui/components/Icon"
import { useMemo } from "react"
import { cn } from "../ui/cn"
import { renderTextWithFilePaths } from "./file-reference"

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

interface DiffLine {
	type: "add" | "remove" | "context" | "hunk"
	content: string
	oldLineNo?: number
	newLineNo?: number
	hunkHeader?: string
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/
const IMAGE_MARKER_RE = /\[Image[^\]]*\]/g

function parseDiff(raw: string): DiffLine[] {
	const lines = raw.split("\n")
	const result: DiffLine[] = []
	let oldLine = 0
	let newLine = 0

	for (const line of lines) {
		// Skip file headers and metadata
		if (
			line.startsWith("diff ") ||
			line.startsWith("index ") ||
			line.startsWith("--- ") ||
			line.startsWith("+++ ") ||
			line.startsWith("=== ") ||
			line.startsWith("\\ ")
		)
			continue

		// Skip empty lines before first hunk
		if (line === "" && result.length === 0) continue

		const hunkMatch = HUNK_RE.exec(line)
		if (hunkMatch) {
			oldLine = Number.parseInt(hunkMatch[1], 10)
			newLine = Number.parseInt(hunkMatch[2], 10)
			result.push({
				type: "hunk",
				content: "",
				hunkHeader: hunkMatch[3].trim() || undefined,
			})
			continue
		}

		const clean = (s: string) => s.replace(IMAGE_MARKER_RE, "").trimEnd()

		if (line.startsWith("+")) {
			result.push({ type: "add", content: clean(line.slice(1)), newLineNo: newLine++ })
		} else if (line.startsWith("-")) {
			result.push({ type: "remove", content: clean(line.slice(1)), oldLineNo: oldLine++ })
		} else {
			// Context line (leading space) or fallback
			result.push({
				type: "context",
				content: line.startsWith(" ") ? line.slice(1) : line,
				oldLineNo: oldLine++,
				newLineNo: newLine++,
			})
		}
	}

	return result
}

/**
 * Render a unified diff with line numbers, colored backgrounds, and clean hunk separators.
 */
export function DiffBlock({ diff, className }: DiffBlockProps) {
	const lines = useMemo(() => parseDiff(diff), [diff])

	const gutterWidth = useMemo(() => {
		let max = 0
		for (const line of lines) {
			if (line.oldLineNo != null && line.oldLineNo > max) max = line.oldLineNo
			if (line.newLineNo != null && line.newLineNo > max) max = line.newLineNo
		}
		return `${Math.max(String(max).length + 1, 3)}ch`
	}, [lines])

	return (
		<pre
			className={cn(
				"max-h-80 overflow-auto rounded-lg bg-background/80 text-xs font-mono",
				"[&::-webkit-scrollbar]:w-1.5",
				"[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
				className,
			)}
		>
			<code>
				{lines.map((line, i) => {
					const key = `${i}-${line.type}`
					if (line.type === "hunk") {
						return (
							<div
								key={key}
								className="bg-diff-hunk-bg px-2.5 py-0.5 text-accent/60 leading-5 select-none"
							>
								{line.hunkHeader ? `@@ ${line.hunkHeader}` : "···"}
							</div>
						)
					}

					return (
						<div
							key={key}
							className={cn(
								"flex leading-5",
								line.type === "add" && "bg-diff-add-bg text-diff-add",
								line.type === "remove" && "bg-diff-remove-bg text-diff-remove",
								line.type === "context" && "text-muted-foreground",
							)}
						>
							<span
								className="shrink-0 select-none text-right text-muted-foreground/30 pr-1"
								style={{ width: gutterWidth }}
							>
								{line.oldLineNo ?? ""}
							</span>
							<span
								className="shrink-0 select-none text-right text-muted-foreground/30 pr-2"
								style={{ width: gutterWidth }}
							>
								{line.newLineNo ?? ""}
							</span>
							<span className="shrink-0 w-[1ch] select-none text-center">
								{line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
							</span>
							<span className="flex-1 whitespace-pre">{line.content}</span>
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

/** Shared status indicator: dashed circle for pending/running, filled check circle for completed, filled X circle for error. */
export function StatusIcon({ state, className }: StatusIconProps) {
	if (state === "pending" || state === "running") {
		return <CircleDashed className={cn("h-3.5 w-3.5 animate-spin", className)} aria-hidden="true" />
	}

	if (state === "completed") {
		return (
			<CheckCircleFilled className={cn("h-3.5 w-3.5 text-success", className)} aria-hidden="true" />
		)
	}

	// error
	return <XCircleFilled className={cn("h-3.5 w-3.5 text-error", className)} aria-hidden="true" />
}

// ─── ToolOutput (plain monospace block) ─────────────────────────

/**
 * Rendered tool output with monospace formatting.
 * Strips ANSI escape codes, detects absolute file paths, and makes them clickable.
 */
export function ToolOutput({ output, className }: ToolOutputProps) {
	if (!output) return null

	const rendered = useMemo(() => renderTextWithFilePaths(stripAnsi(output)), [output])

	return (
		<pre
			className={cn(
				"max-h-64 overflow-auto rounded-lg bg-background/80 p-3 text-xs text-muted-foreground font-mono",
				"[&::-webkit-scrollbar]:w-1.5",
				"[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
				className,
			)}
		>
			<code>{rendered}</code>
		</pre>
	)
}

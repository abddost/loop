import { CheckCircleFilled, XCircleFilled } from "@openai/apps-sdk-ui/components/Icon"
import { useEffect, useMemo, useState } from "react"
import { parseDiff } from "../../lib/diff"
import { type DiffToken, highlightDiffLines, langFromPath } from "../../lib/markdown/highlighter"
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
	/** File path used to detect language for syntax highlighting. */
	filePath?: string
	className?: string
}

/**
 * Render a unified diff with syntax-highlighted code, line numbers,
 * colored left-edge indicators, and clean hunk separators.
 *
 * Two-phase rendering: plain text appears instantly, then Shiki
 * tokenization runs async and tokens are swapped in without layout shift.
 */
export function DiffBlock({ diff, filePath, className }: DiffBlockProps) {
	const lines = useMemo(() => parseDiff(diff), [diff])

	const gutterWidth = useMemo(() => {
		let max = 0
		for (const line of lines) {
			if (line.oldLineNo != null && line.oldLineNo > max) max = line.oldLineNo
			if (line.newLineNo != null && line.newLineNo > max) max = line.newLineNo
		}
		return `${Math.max(String(max).length + 1, 3)}ch`
	}, [lines])

	// Extract code-only lines (skip hunks) for tokenization
	const codeLines = useMemo(
		() => lines.filter((l) => l.type !== "hunk").map((l) => l.content),
		[lines],
	)

	const lang = useMemo(() => (filePath ? langFromPath(filePath) : "text"), [filePath])

	// Async syntax highlighting — null means "not yet highlighted"
	const [tokens, setTokens] = useState<DiffToken[][] | null>(null)

	useEffect(() => {
		if (lang === "text" || codeLines.length === 0) {
			setTokens(null)
			return
		}

		let cancelled = false
		highlightDiffLines(codeLines, lang).then((result) => {
			if (!cancelled) setTokens(result)
		})
		return () => {
			cancelled = true
		}
	}, [codeLines, lang])

	// Build a map from diff-line index → token array (skipping hunk lines)
	const tokenMap = useMemo(() => {
		if (!tokens) return null
		const map = new Map<number, DiffToken[]>()
		let tokenIdx = 0
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].type !== "hunk" && tokenIdx < tokens.length) {
				map.set(i, tokens[tokenIdx])
				tokenIdx++
			}
		}
		return map
	}, [lines, tokens])

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

					const lineNo =
						line.type === "remove" ? line.oldLineNo : (line.newLineNo ?? line.oldLineNo)

					const lineTokens = tokenMap?.get(i)

					return (
						<div
							key={key}
							className={cn(
								"flex leading-5",
								line.type === "add" && "bg-diff-add-bg",
								line.type === "remove" && "bg-diff-remove-bg",
							)}
						>
							<span
								className={cn(
									"w-[3px] shrink-0",
									line.type === "add" && "bg-diff-add",
									line.type === "remove" && "bg-diff-remove",
								)}
							/>
							<span
								className="shrink-0 select-none text-right text-muted-foreground/30 px-2"
								style={{ width: gutterWidth }}
							>
								{lineNo ?? ""}
							</span>
							<span className="flex-1 whitespace-pre pr-2">
								{lineTokens ? (
									lineTokens.map((t, j) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional and never reordered
										<span key={j} style={{ color: t.color }}>
											{t.content}
										</span>
									))
								) : (
									<span
										className={cn(
											line.type === "context" && "text-muted-foreground",
											line.type === "add" && "text-diff-add",
											line.type === "remove" && "text-diff-remove",
										)}
									>
										{line.content}
									</span>
								)}
							</span>
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

/** Spinning dashed circle — shared indicator for running/pending states. */
export function SpinningCircle({ className }: { className?: string }) {
	return (
		<svg
			className={cn("size-3.5 animate-spin text-muted-foreground", className)}
			viewBox="0 0 16 16"
			fill="none"
			aria-hidden="true"
		>
			<circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28 10" />
		</svg>
	)
}

/** Shared status indicator: spinning circle for pending/running, filled check circle for completed, filled X circle for error. */
export function StatusIcon({ state, className }: StatusIconProps) {
	if (state === "pending" || state === "running") {
		return <SpinningCircle className={className} />
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

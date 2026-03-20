import { useCallback } from "react"
import { openFile } from "../../lib/editor"
import { cn } from "../ui/cn"

export interface FileReferenceProps {
	/** File path (absolute or relative to workspace). */
	path: string
	line?: number
	/** Override display text. Defaults to path. */
	display?: string
	className?: string
}

/**
 * Clickable file reference that opens in the user's preferred editor.
 *
 * Uses a `<span>` rather than `<button>` so it can be nested inside other
 * interactive elements (e.g. the expand/collapse button in tool cards)
 * without violating HTML nesting rules.
 */
export function FileReference({ path, line, display, className }: FileReferenceProps) {
	const handleClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			e.preventDefault()
			openFile(path, line)
		},
		[path, line],
	)

	const label = display ?? (line ? `${path}:${line}` : path)
	const title = line ? `Open ${path}:${line}` : `Open ${path}`

	return (
		// biome-ignore lint/a11y/useSemanticElements: span required for valid nesting inside buttons
		<span
			role="link"
			tabIndex={0}
			className={cn(
				"cursor-pointer transition-colors hover:text-accent hover:underline underline-offset-2",
				className,
			)}
			onClick={handleClick}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.stopPropagation()
					openFile(path, line)
				}
			}}
			title={title}
		>
			{label}
		</span>
	)
}

// ────────────────────────────────────────────────────────────
// File path detection for markdown inline code
// ────────────────────────────────────────────────────────────

/**
 * Regex to detect file-path-like inline code.
 * Matches:
 *   - Relative: `src/app/main.tsx`, `./src/main.ts:42`, `../foo/bar.ts`
 *   - Absolute: `/Users/foo/bar.ts`, `/etc/config.json:10`
 * Does NOT match: single words, commands with spaces, etc.
 */
const FILE_PATH_RE = /^(\/|\.{0,2}\/)?([a-zA-Z0-9._@~-]+\/)+[a-zA-Z0-9._@~-]+(:\d+)?$/

/**
 * Parse potential file path from inline code text.
 * Returns `{ path, line }` if it looks like a file reference, else null.
 */
export function parseFilePath(text: string): { path: string; line?: number } | null {
	if (!FILE_PATH_RE.test(text)) return null
	const colonIdx = text.lastIndexOf(":")
	if (colonIdx > 0 && /^\d+$/.test(text.slice(colonIdx + 1))) {
		return {
			path: text.slice(0, colonIdx),
			line: Number.parseInt(text.slice(colonIdx + 1), 10),
		}
	}
	return { path: text }
}

// ────────────────────────────────────────────────────────────
// File path detection for tool output (monospace blocks)
// ────────────────────────────────────────────────────────────

/**
 * Matches absolute file paths with a file extension, optionally followed by :lineNumber.
 * Used to detect clickable paths in Glob/Grep/Bash/etc. tool output.
 */
const ABSOLUTE_PATH_RE = /(\/(?:[a-zA-Z0-9._@~-]+\/)*[a-zA-Z0-9._@-]+\.[a-zA-Z0-9]{1,10}(?::\d+)?)/g

/**
 * Render a text string with absolute file paths replaced by clickable FileReference elements.
 * Returns the original string unchanged if no paths are detected (fast path).
 */
export function renderTextWithFilePaths(text: string): React.ReactNode {
	if (!text || !text.includes("/")) return text

	const parts: React.ReactNode[] = []
	let lastIndex = 0
	let keyIdx = 0

	for (const match of text.matchAll(ABSOLUTE_PATH_RE)) {
		const fullMatch = match[0]
		const matchStart = match.index

		// Add text before match
		if (matchStart > lastIndex) {
			parts.push(text.slice(lastIndex, matchStart))
		}

		// Parse optional :lineNumber suffix
		const colonIdx = fullMatch.lastIndexOf(":")
		let filePath = fullMatch
		let line: number | undefined

		if (colonIdx > 0 && /^\d+$/.test(fullMatch.slice(colonIdx + 1))) {
			filePath = fullMatch.slice(0, colonIdx)
			line = Number.parseInt(fullMatch.slice(colonIdx + 1), 10)
		}

		parts.push(<FileReference key={keyIdx++} path={filePath} line={line} display={fullMatch} />)
		lastIndex = matchStart + fullMatch.length
	}

	if (parts.length === 0) return text

	// Add remaining text
	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex))
	}

	return <>{parts}</>
}

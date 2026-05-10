import { SearchQuery, getSearchQuery, setSearchQuery } from "@codemirror/search"
import type { EditorView } from "@codemirror/view"
import { ChevronDown, ChevronUp, X } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "../ui/cn"
import { findNextCentered, findPreviousCentered } from "./codemirror-viewer"

interface SearchOverlayProps {
	open: boolean
	onClose: () => void
	viewRef: React.RefObject<EditorView | null>
}

interface MatchInfo {
	current: number
	total: number
}

/**
 * Pull a seed string from the editor's current selection for the find input.
 * Returns the first non-empty line (trimmed) so a line-mode selection like
 * `\nexport interface OrderSummary {...` still seeds with the visible code,
 * not an empty leading newline. Returns null if the selection is empty.
 */
function pickSeedFromSelection(view: EditorView): string | null {
	const sel = view.state.selection.main
	if (sel.empty) return null
	const raw = view.state.doc.sliceString(sel.from, sel.to)
	for (const line of raw.split("\n")) {
		const trimmed = line.trim()
		if (trimmed.length > 0) return trimmed
	}
	return null
}

function countMatches(view: EditorView, query: SearchQuery): MatchInfo {
	if (!query.search) return { current: 0, total: 0 }
	const cursor = query.getCursor(view.state.doc)
	const head = view.state.selection.main.from
	let total = 0
	let current = 0
	// SearchQuery's cursor is iterator-like: { value, done }
	for (let next = cursor.next(); !next.done; next = cursor.next()) {
		total++
		const m = next.value as { from: number; to: number }
		if (current === 0 && m.from >= head) current = total
	}
	if (total > 0 && current === 0) current = 1
	return { current, total }
}

export function SearchOverlay({ open, onClose, viewRef }: SearchOverlayProps) {
	const [query, setQuery] = useState("")
	const [caseSensitive, setCaseSensitive] = useState(false)
	const [wholeWord, setWholeWord] = useState(false)
	const [regexp, setRegexp] = useState(false)
	const [info, setInfo] = useState<MatchInfo>({ current: 0, total: 0 })
	const [invalidRegex, setInvalidRegex] = useState(false)

	const inputRef = useRef<HTMLInputElement>(null)
	const lastQueryRef = useRef("")

	// Apply search query to editor whenever options change.
	useEffect(() => {
		const view = viewRef.current
		if (!view || !open) return

		// Validate regex before constructing the query — invalid patterns
		// throw inside SearchQuery's own RegExp build.
		if (regexp && query) {
			try {
				new RegExp(query)
				setInvalidRegex(false)
			} catch {
				setInvalidRegex(true)
				return
			}
		} else {
			setInvalidRegex(false)
		}

		const sq = new SearchQuery({
			search: query,
			caseSensitive,
			regexp,
			wholeWord,
		})
		view.dispatch({ effects: setSearchQuery.of(sq) })

		// On first non-empty query, jump to the next match (matches VSCode).
		if (query && lastQueryRef.current !== query) {
			findNextCentered(view)
		}
		lastQueryRef.current = query

		setInfo(countMatches(view, sq))
	}, [query, caseSensitive, wholeWord, regexp, open, viewRef])

	// Autofocus + select on open. Pre-fill from the active selection so
	// Cmd+F on a highlighted word seeds the search. Robust against:
	//  - selections that begin with a newline (line-mode select drag),
	//  - leading/trailing whitespace,
	//  - multi-line selections (single-line input → take first content line).
	useEffect(() => {
		if (!open) return
		const view = viewRef.current
		if (view) {
			const seed = pickSeedFromSelection(view) ?? getSearchQuery(view.state).search
			if (seed) setQuery(seed)
		}
		requestAnimationFrame(() => inputRef.current?.select())
	}, [open, viewRef])

	const handleNext = useCallback(() => {
		const view = viewRef.current
		if (!view) return
		findNextCentered(view)
		setInfo(countMatches(view, getSearchQuery(view.state)))
	}, [viewRef])

	const handlePrev = useCallback(() => {
		const view = viewRef.current
		if (!view) return
		findPreviousCentered(view)
		setInfo(countMatches(view, getSearchQuery(view.state)))
	}, [viewRef])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Escape") {
				e.preventDefault()
				onClose()
				viewRef.current?.focus()
				return
			}
			if (e.key === "Enter") {
				e.preventDefault()
				if (e.shiftKey) handlePrev()
				else handleNext()
				return
			}
		},
		[onClose, handleNext, handlePrev, viewRef],
	)

	if (!open) return null

	const counterText = !query
		? null
		: invalidRegex
			? "invalid"
			: info.total === 0
				? "No results"
				: `${info.current} of ${info.total}`

	return (
		<div
			className={cn(
				"absolute top-2 right-4 z-10 flex items-center gap-1 rounded-md border border-border/60 bg-overlay px-1.5 py-1 text-xs",
				"shadow-[var(--shadow-dropdown)]",
			)}
		>
			<input
				ref={inputRef}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Find"
				className={cn(
					"w-48 bg-transparent px-1.5 py-0.5 text-foreground outline-none placeholder:text-muted/70",
					info.total === 0 && query && "text-error",
				)}
				spellCheck={false}
				autoComplete="off"
			/>

			<div className="mx-0.5 flex shrink-0 items-center gap-0.5">
				<ToggleButton
					active={caseSensitive}
					onClick={() => setCaseSensitive((v) => !v)}
					title="Match Case (Alt+C)"
					label="Aa"
				/>
				<ToggleButton
					active={wholeWord}
					onClick={() => setWholeWord((v) => !v)}
					title="Match Whole Word (Alt+W)"
					label={
						<span className="relative">
							ab
							<span className="absolute -bottom-[2px] left-0 h-px w-full bg-current" />
						</span>
					}
				/>
				<ToggleButton
					active={regexp}
					onClick={() => setRegexp((v) => !v)}
					title="Use Regular Expression (Alt+R)"
					label=".*"
				/>
			</div>

			<span
				className={cn(
					"min-w-[58px] shrink-0 px-1 text-center tabular-nums text-[11px]",
					counterText === "No results" || counterText === "invalid" ? "text-error" : "text-muted",
				)}
			>
				{counterText ?? ""}
			</span>

			<div className="flex shrink-0 items-center gap-0.5">
				<IconButton onClick={handlePrev} title="Previous Match (Shift+Enter)">
					<ChevronUp className="h-3.5 w-3.5" />
				</IconButton>
				<IconButton onClick={handleNext} title="Next Match (Enter)">
					<ChevronDown className="h-3.5 w-3.5" />
				</IconButton>
				<IconButton
					onClick={() => {
						onClose()
						viewRef.current?.focus()
					}}
					title="Close (Escape)"
				>
					<X className="h-3.5 w-3.5" />
				</IconButton>
			</div>
		</div>
	)
}

interface ToggleButtonProps {
	active: boolean
	onClick: () => void
	title: string
	label: React.ReactNode
}

function ToggleButton({ active, onClick, title, label }: ToggleButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			className={cn(
				"flex h-6 w-6 cursor-pointer items-center justify-center rounded font-mono text-[10px] transition-colors",
				active
					? "bg-accent/20 text-accent ring-1 ring-accent/40"
					: "text-muted hover:bg-surface-hover hover:text-foreground",
			)}
		>
			{label}
		</button>
	)
}

interface IconButtonProps {
	onClick: () => void
	title: string
	children: React.ReactNode
}

function IconButton({ onClick, title, children }: IconButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
		>
			{children}
		</button>
	)
}

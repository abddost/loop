import { useEffect, useRef } from "react"
import { cn } from "../ui/cn"

// ── Row model ───────────────────────────────────────────────────────

export interface SlashCommandRow {
	/** Command name without the leading slash, e.g. `clear`, `compact`. */
	name: string
	/** Human-readable description from the SDK. */
	description: string
	/** Argument hint such as `<file>` or `[instructions]`. Empty when
	 *  the command takes no args (used to decide trailing space behaviour
	 *  on selection). */
	argumentHint: string
}

// ── Ranking ─────────────────────────────────────────────────────────

/**
 * Rank commands by `query` against name + description. Mirrors
 * t3code's `composerSlashCommandSearch.ts` priorities:
 *  1. exact name match
 *  2. name prefix match (lower index = higher score)
 *  3. name substring match
 *  4. description substring match
 *  5. fuzzy subsequence over `name`
 */
export function rankSlashCommands(
	commands: ReadonlyArray<SlashCommandRow>,
	query: string,
	limit = 50,
): SlashCommandRow[] {
	const trimmed = query.trim().toLowerCase()
	if (!trimmed) {
		return [...commands]
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(0, limit)
	}

	const scored: Array<{ row: SlashCommandRow; score: number }> = []
	for (const row of commands) {
		const name = row.name.toLowerCase()
		const desc = row.description.toLowerCase()
		let score = 0
		if (name === trimmed) score = 1_000_000
		else if (name.startsWith(trimmed)) score = 500_000 - trimmed.length
		else {
			const nameIdx = name.indexOf(trimmed)
			if (nameIdx !== -1) score = 100_000 - nameIdx
			else {
				const descIdx = desc.indexOf(trimmed)
				if (descIdx !== -1) score = 20_000 - Math.min(descIdx, 19_000)
				else if (isSubsequence(trimmed, name)) score = 5_000
			}
		}
		if (score > 0) scored.push({ row, score })
	}
	scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
	return scored.slice(0, limit).map((s) => s.row)
}

function isSubsequence(needle: string, haystack: string): boolean {
	let hi = 0
	for (const ch of needle) {
		while (hi < haystack.length && haystack[hi] !== ch) hi++
		if (hi === haystack.length) return false
		hi++
	}
	return true
}

// ── Component ───────────────────────────────────────────────────────

interface SlashCommandMenuProps {
	items: SlashCommandRow[]
	activeIdx: number
	loading: boolean
	onSelect: (item: SlashCommandRow) => void
	onHover: (idx: number) => void
}

const MAX_VISIBLE = 7
// Each row is two lines + tight padding. Approximate height for the
// scroll-cap calculation; if a row's name wraps over two lines it'll
// still scroll cleanly.
const ROW_HEIGHT = 38

export function SlashCommandMenu({
	items,
	activeIdx,
	loading,
	onSelect,
	onHover,
}: SlashCommandMenuProps) {
	const listRef = useRef<HTMLDivElement>(null)
	const activeRef = useRef<HTMLButtonElement>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on index change
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" })
	}, [activeIdx])

	// Pin to the input bar's left edge but stretch all the way across
	// so plugin commands like `/Vercel:analyze_deployment_performance`
	// fit on a single line. The `right-3` mirror keeps the menu inside
	// the surface padding on both sides.
	const wrapperClass = cn("absolute bottom-full right-3 left-3 z-30 mb-2")
	const surfaceClass = cn(
		"overflow-hidden rounded-2xl border border-border/60 bg-overlay",
		"shadow-[var(--shadow-dropdown),0_24px_48px_-12px_rgba(0,0,0,0.55)]",
	)

	if (items.length === 0 && !loading) {
		return (
			<div className={wrapperClass}>
				<div className={cn(surfaceClass, "px-3 py-2 text-xs text-muted")}>No commands</div>
			</div>
		)
	}

	return (
		<div className={wrapperClass}>
			<div className={surfaceClass}>
				<div
					ref={listRef}
					className="overflow-y-auto px-1 py-1"
					style={{ maxHeight: `${MAX_VISIBLE * ROW_HEIGHT}px` }}
				>
					{loading && items.length === 0 && (
						<div className="px-3 py-1.5 text-xs text-muted">Loading commands…</div>
					)}
					{items.map((item, i) => (
						<SlashCommandRowView
							key={item.name}
							ref={i === activeIdx ? activeRef : undefined}
							item={item}
							active={i === activeIdx}
							onClick={() => onSelect(item)}
							onMouseEnter={() => onHover(i)}
						/>
					))}
				</div>
			</div>
		</div>
	)
}

interface SlashCommandRowViewProps {
	item: SlashCommandRow
	active: boolean
	onClick: () => void
	onMouseEnter: () => void
	ref?: React.RefObject<HTMLButtonElement | null>
}

function SlashCommandRowView({
	item,
	active,
	onClick,
	onMouseEnter,
	ref,
}: SlashCommandRowViewProps) {
	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			onMouseEnter={onMouseEnter}
			// Prevent textarea blur so the cursor stays in place.
			onMouseDown={(e) => e.preventDefault()}
			className={cn(
				"flex w-full flex-col rounded-md px-3 py-1 text-left leading-tight",
				active ? "bg-foreground/10" : "hover:bg-foreground/8",
			)}
		>
			<div className="flex min-w-0 items-center gap-2">
				<span className="truncate font-medium text-xs tabular-nums text-foreground">
					/{item.name}
				</span>
				{item.argumentHint && (
					<span className="shrink-0 rounded-md bg-foreground/8 px-1.5 py-0 text-[10.5px] text-muted">
						{item.argumentHint}
					</span>
				)}
			</div>
			{item.description && (
				<span className="truncate text-[10.5px] text-muted">{item.description}</span>
			)}
		</button>
	)
}

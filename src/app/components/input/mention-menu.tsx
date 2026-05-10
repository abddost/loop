import { Folder } from "@openai/apps-sdk-ui/components/Icon"
import { useEffect, useRef } from "react"
import { FileIcon } from "../chat/file-icon"
import { cn } from "../ui/cn"

// ── Row model ───────────────────────────────────────────────────────

export interface MentionRow {
	type: "file" | "folder"
	/** Workspace-relative path (no leading slash, e.g. "src/app/cart"). */
	path: string
	/** Last path segment shown as the primary label. */
	name: string
	/** Parent directory shown as a muted hint, empty for top-level. */
	parent: string
}

// ── Folder derivation + ranking ─────────────────────────────────────

/**
 * Synthesize the folder set from a flat file list. We compute every
 * prefix of every file path so a workspace like
 *   src/app/cart/page.tsx
 * yields the folders src, src/app, src/app/cart.
 */
function deriveFolders(files: string[]): string[] {
	const folders = new Set<string>()
	for (const file of files) {
		const parts = file.split("/")
		for (let i = 1; i < parts.length; i++) {
			folders.add(parts.slice(0, i).join("/"))
		}
	}
	return Array.from(folders).sort()
}

function basename(path: string): string {
	const idx = path.lastIndexOf("/")
	return idx === -1 ? path : path.slice(idx + 1)
}

function dirname(path: string): string {
	const idx = path.lastIndexOf("/")
	return idx === -1 ? "" : path.slice(0, idx)
}

function scoreRow(row: MentionRow, lowerQuery: string): number {
	const name = row.name.toLowerCase()
	const path = row.path.toLowerCase()

	if (name === lowerQuery) return 1_000_000
	const nameIdx = name.indexOf(lowerQuery)
	if (nameIdx !== -1) return 100_000 - nameIdx
	const pathIdx = path.indexOf(lowerQuery)
	if (pathIdx !== -1) return 50_000 - pathIdx

	// Subsequence over full path
	let pi = 0
	for (const ch of lowerQuery) {
		while (pi < path.length && path[pi] !== ch) pi++
		if (pi === path.length) return 0
		pi++
	}
	return 10_000
}

/**
 * Build the ranked list of folders + files matching the query.
 * Empty query → top-level entries only (folders first), matching the
 * "no input yet" state in VSCode/Linear-style mention menus.
 */
export function rankMentions(files: string[], query: string, limit = 50): MentionRow[] {
	const folders = deriveFolders(files)

	const allRows: MentionRow[] = [
		...folders.map((p) => ({
			type: "folder" as const,
			path: p,
			name: basename(p),
			parent: dirname(p),
		})),
		...files.map((p) => ({
			type: "file" as const,
			path: p,
			name: basename(p),
			parent: dirname(p),
		})),
	]

	if (!query) {
		return allRows.filter((r) => r.parent === "").slice(0, limit)
	}

	const lower = query.toLowerCase()
	const scored: Array<{ row: MentionRow; score: number }> = []
	for (const row of allRows) {
		const s = scoreRow(row, lower)
		if (s > 0) scored.push({ row, score: s })
	}
	scored.sort((a, b) => b.score - a.score)
	return scored.slice(0, limit).map((s) => s.row)
}

// ── Component ───────────────────────────────────────────────────────

interface MentionMenuProps {
	items: MentionRow[]
	activeIdx: number
	loading: boolean
	onSelect: (item: MentionRow) => void
	onHover: (idx: number) => void
}

const MAX_VISIBLE = 10 // rows before scroll kicks in
const ROW_HEIGHT = 26 // px

export function MentionMenu({ items, activeIdx, loading, onSelect, onHover }: MentionMenuProps) {
	const listRef = useRef<HTMLDivElement>(null)
	const activeRef = useRef<HTMLButtonElement>(null)

	// Scroll the active row into view when keyboard navigation moves it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on index change
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" })
	}, [activeIdx])

	const wrapperClass = cn(
		"absolute bottom-full left-3 z-30 mb-2 w-[380px] max-w-[calc(100%-1.5rem)]",
	)
	const surfaceClass = cn(
		"overflow-hidden rounded-2xl border border-border/60 bg-overlay",
		"shadow-[var(--shadow-dropdown),0_24px_48px_-12px_rgba(0,0,0,0.55)]",
	)

	if (items.length === 0 && !loading) {
		return (
			<div className={wrapperClass}>
				<div className={cn(surfaceClass, "px-3 py-2 text-xs text-muted")}>No matches</div>
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
						<div className="px-3 py-1.5 text-xs text-muted">Loading files…</div>
					)}
					{items.map((item, i) => (
						<MentionRowView
							key={`${item.type}:${item.path}`}
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

interface MentionRowViewProps {
	item: MentionRow
	active: boolean
	onClick: () => void
	onMouseEnter: () => void
	ref?: React.RefObject<HTMLButtonElement | null>
}

function MentionRowView({ item, active, onClick, onMouseEnter, ref }: MentionRowViewProps) {
	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			onMouseEnter={onMouseEnter}
			// Prevent textarea blur so the cursor stays in place when the menu
			// is dismissed by selection (we strip the @query from the input).
			onMouseDown={(e) => e.preventDefault()}
			className={cn(
				"flex h-[26px] w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground",
				active ? "bg-foreground/10" : "hover:bg-foreground/8",
			)}
		>
			{item.type === "folder" ? (
				<Folder className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
			) : (
				<FileIcon filePath={item.path} size={13} />
			)}
			<span className="truncate">{item.name}</span>
			{item.parent && <span className="truncate text-[10.5px] text-muted">{item.parent}</span>}
		</button>
	)
}

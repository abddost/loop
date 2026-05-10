import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useFilePanelStore } from "../../stores/file-panel-store"
import { type QuickOpenMatch, rankMatches, useQuickOpenStore } from "../../stores/quick-open-store"
import { FileIcon } from "../chat/file-icon"
import { cn } from "../ui/cn"

const MAX_RESULTS = 50

export function QuickOpenModal() {
	const open = useQuickOpenStore((s) => s.open)
	const query = useQuickOpenStore((s) => s.query)
	const files = useQuickOpenStore((s) => s.files)
	const loading = useQuickOpenStore((s) => s.loading)
	const error = useQuickOpenStore((s) => s.error)
	const setQuery = useQuickOpenStore((s) => s.setQuery)
	const closeModal = useQuickOpenStore((s) => s.closeModal)

	const openFile = useFilePanelStore((s) => s.openFile)
	const togglePanel = useFilePanelStore((s) => s.togglePanel)
	const panelOpen = useFilePanelStore((s) => s.panelOpen)

	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)
	const activeRef = useRef<HTMLButtonElement>(null)
	const [activeIdx, setActiveIdx] = useState(0)

	const matches = useMemo(() => rankMatches(query, files, MAX_RESULTS), [query, files])

	// Reset highlight when matches change
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on matches change
	useEffect(() => {
		setActiveIdx(0)
		if (listRef.current) listRef.current.scrollTop = 0
	}, [matches])

	// Autofocus input on open
	useEffect(() => {
		if (open) {
			requestAnimationFrame(() => inputRef.current?.focus())
		}
	}, [open])

	// Keep highlighted item in view
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on index change
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" })
	}, [activeIdx])

	const handleSelect = useCallback(
		(match: QuickOpenMatch) => {
			closeModal()
			if (!panelOpen) togglePanel()
			openFile(match.path).catch((err) => console.error("[quick-open] openFile failed:", err))
		},
		[closeModal, openFile, panelOpen, togglePanel],
	)

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				closeModal()
				return
			}
			if (e.key === "ArrowDown") {
				e.preventDefault()
				setActiveIdx((i) => Math.min(matches.length - 1, i + 1))
				return
			}
			if (e.key === "ArrowUp") {
				e.preventDefault()
				setActiveIdx((i) => Math.max(0, i - 1))
				return
			}
			if (e.key === "Enter") {
				e.preventDefault()
				const match = matches[activeIdx]
				if (match) handleSelect(match)
			}
		},
		[matches, activeIdx, handleSelect, closeModal],
	)

	if (!open) return null

	return (
		<div
			className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 pt-24"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) closeModal()
			}}
		>
			<div className="w-[640px] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-overlay shadow-[var(--shadow-dropdown)]">
				<input
					ref={inputRef}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={loading ? "Loading files..." : "Type a file name to open"}
					className="block w-full border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted"
					autoComplete="off"
					spellCheck={false}
				/>
				<div ref={listRef} className="max-h-[400px] overflow-y-auto py-1">
					{error && <div className="px-4 py-3 text-xs text-error">Error: {error}</div>}
					{!error && matches.length === 0 && !loading && (
						<div className="px-4 py-3 text-xs text-muted">{query ? "No matches" : "No files"}</div>
					)}
					{matches.map((match, i) => (
						<QuickOpenRow
							key={match.path}
							ref={i === activeIdx ? activeRef : undefined}
							match={match}
							active={i === activeIdx}
							onClick={() => handleSelect(match)}
							onMouseEnter={() => setActiveIdx(i)}
						/>
					))}
				</div>
			</div>
		</div>
	)
}

interface QuickOpenRowProps {
	match: QuickOpenMatch
	active: boolean
	onClick: () => void
	onMouseEnter: () => void
	ref?: React.RefObject<HTMLButtonElement | null>
}

function QuickOpenRow({ match, active, onClick, onMouseEnter, ref }: QuickOpenRowProps) {
	const dirPart = match.path.slice(0, match.path.length - match.basename.length).replace(/\/$/, "")
	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			onMouseEnter={onMouseEnter}
			className={cn(
				"flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs",
				active ? "bg-accent/15 text-foreground" : "text-foreground hover:bg-surface-hover",
			)}
		>
			<FileIcon filePath={match.path} size={14} />
			<span className="truncate">{match.basename}</span>
			{dirPart && <span className="truncate text-muted">{dirPart}</span>}
		</button>
	)
}

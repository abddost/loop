import {
	ACTION_CATEGORIES,
	ACTION_IDS,
	ACTION_METADATA,
	type ActionCategory,
	type ActionId,
	DEFAULT_KEYBINDINGS,
} from "@core/schema/keybinding"
import { ArrowRotateCcw, Search, X } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
	formatKeybind,
	formatKeybindParts,
	parseKeybind,
	recordKeybindFromEvent,
	signatureFromKeybind,
} from "../../lib/keybinding"
import { useConfigStore } from "../../stores/config-store"
import { cn } from "../ui/cn"
import { Tooltip } from "../ui/tooltip"

// ── Category labels ────────────────────────────────────────────

const CATEGORY_LABELS: Record<ActionCategory, string> = {
	general: "General",
	session: "Session",
	navigation: "Navigation",
	terminal: "Terminal",
}

// ── Types ──────────────────────────────────────────────────────

interface KeybindEntry {
	id: ActionId
	title: string
	category: ActionCategory
	defaultKeybind: string
	currentKeybind: string
	isOverridden: boolean
}

// ── Helpers ────────────────────────────────────────────────────

function buildEntries(overrides: Record<string, string>): KeybindEntry[] {
	return ACTION_IDS.map((id) => {
		const meta = ACTION_METADATA[id]
		const defaultKeybind = DEFAULT_KEYBINDINGS[id]
		const override = overrides[id]
		return {
			id,
			title: meta.title,
			category: meta.category,
			defaultKeybind,
			currentKeybind: override ?? defaultKeybind,
			isOverridden: override !== undefined,
		}
	})
}

function groupByCategory(entries: KeybindEntry[]): Map<ActionCategory, KeybindEntry[]> {
	const groups = new Map<ActionCategory, KeybindEntry[]>()
	for (const cat of ACTION_CATEGORIES) groups.set(cat, [])
	for (const entry of entries) {
		groups.get(entry.category)?.push(entry)
	}
	return groups
}

function filterEntries(entries: KeybindEntry[], query: string): KeybindEntry[] {
	if (!query.trim()) return entries
	const q = query.toLowerCase()
	return entries.filter(
		(e) =>
			e.title.toLowerCase().includes(q) ||
			e.id.toLowerCase().includes(q) ||
			formatKeybind(e.currentKeybind).toLowerCase().includes(q),
	)
}

/** Build a map of signature → { id, title }[] for conflict detection. */
function buildUsedMap(entries: KeybindEntry[]): Map<string, { id: string; title: string }[]> {
	const map = new Map<string, { id: string; title: string }[]>()
	for (const entry of entries) {
		if (!entry.currentKeybind || entry.currentKeybind === "none") continue
		for (const kb of parseKeybind(entry.currentKeybind)) {
			if (!kb.key) continue
			const sig = signatureFromKeybind(kb)
			const list = map.get(sig) ?? []
			list.push({ id: entry.id, title: entry.title })
			map.set(sig, list)
		}
	}
	return map
}

// ── Main Component ─────────────────────────────────────────────

export function KeybindingConfig({ className }: { className?: string }) {
	const overrides = useConfigStore((s) => s.config.keybindings)
	const [filter, setFilter] = useState("")
	const [capturing, setCapturing] = useState<string | null>(null)
	const [conflict, setConflict] = useState<string | null>(null)

	const allEntries = useMemo(() => buildEntries(overrides), [overrides])
	const filtered = useMemo(() => filterEntries(allEntries, filter), [allEntries, filter])
	const grouped = useMemo(() => groupByCategory(filtered), [filtered])
	const usedMap = useMemo(() => buildUsedMap(allEntries), [allEntries])

	const hasOverrides = useMemo(() => allEntries.some((e) => e.isOverridden), [allEntries])

	const hasResults = useMemo(
		() => Array.from(grouped.values()).some((g) => g.length > 0),
		[grouped],
	)

	// ── Key capture ────────────────────────────────────────

	const stopCapture = useCallback(() => {
		setCapturing(null)
		setConflict(null)
	}, [])

	const setKeybind = useCallback((id: string, keybind: string) => {
		useConfigStore.getState().update({ keybindings: { [id]: keybind } })
	}, [])

	const resetKeybind = useCallback((id: string) => {
		// Remove the override by setting back to the default
		const current = { ...useConfigStore.getState().config.keybindings }
		delete current[id]
		// Replace all keybindings (not a merge)
		useConfigStore.getState().update({ keybindings: current })
	}, [])

	const resetAll = useCallback(() => {
		stopCapture()
		// Patch each override key to its default so the server merges correctly
		const current = useConfigStore.getState().config.keybindings
		const resets: Record<string, string> = {}
		for (const key of Object.keys(current)) {
			resets[key] = DEFAULT_KEYBINDINGS[key as ActionId] ?? ""
		}
		if (Object.keys(resets).length > 0) {
			useConfigStore.getState().update({ keybindings: resets })
		}
	}, [stopCapture])

	useEffect(() => {
		if (!capturing) return

		const handle = (event: KeyboardEvent) => {
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()

			if (event.key === "Escape") {
				stopCapture()
				return
			}

			// Backspace/Delete without modifiers clears the binding
			if (
				(event.key === "Backspace" || event.key === "Delete") &&
				!event.ctrlKey &&
				!event.metaKey &&
				!event.altKey &&
				!event.shiftKey
			) {
				setKeybind(capturing, "none")
				stopCapture()
				return
			}

			const next = recordKeybindFromEvent(event)
			if (!next) return

			// Check for conflicts
			for (const kb of parseKeybind(next)) {
				if (!kb.key) continue
				const sig = signatureFromKeybind(kb)
				const conflicts = usedMap.get(sig)?.filter((c) => c.id !== capturing)
				if (conflicts && conflicts.length > 0) {
					setConflict(`Already assigned to "${conflicts[0].title}"`)
					return
				}
			}

			setKeybind(capturing, next)
			stopCapture()
		}

		document.addEventListener("keydown", handle, true)
		return () => document.removeEventListener("keydown", handle, true)
	}, [capturing, usedMap, stopCapture, setKeybind])

	return (
		<div className={className}>
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-xl font-semibold text-foreground">Keyboard Shortcuts</h1>
				{hasOverrides && (
					<button
						type="button"
						onClick={resetAll}
						className="el-btn-pill-sm flex items-center gap-1.5 !bg-transparent text-muted shadow-[var(--shadow-inset)] hover:text-foreground"
					>
						<ArrowRotateCcw className="h-3 w-3" aria-hidden="true" />
						<span>Reset All</span>
					</button>
				)}
			</div>

			{/* Search */}
			<div className="relative mb-6">
				<Search
					className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
					aria-hidden="true"
				/>
				<input
					type="text"
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					placeholder="Search shortcuts..."
					className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-8 text-xs text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
				/>
				{filter && (
					<button
						type="button"
						onClick={() => setFilter("")}
						className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
					>
						<X className="h-3 w-3" aria-hidden="true" />
					</button>
				)}
			</div>

			{/* Conflict toast */}
			{conflict && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-xs text-warning">
					<span>{conflict}</span>
					<button
						type="button"
						onClick={() => setConflict(null)}
						className="ml-auto text-warning/70 hover:text-warning"
					>
						<X className="h-3 w-3" aria-hidden="true" />
					</button>
				</div>
			)}

			{/* Grouped sections */}
			<div className="space-y-8">
				{ACTION_CATEGORIES.map((category) => {
					const entries = grouped.get(category) ?? []
					if (entries.length === 0) return null

					return (
						<div key={category}>
							<h2 className="mb-3 text-sm font-semibold text-foreground">
								{CATEGORY_LABELS[category]}
							</h2>
							<div className="el-card divide-y divide-[var(--separator)]">
								{entries.map((entry) => (
									<KeybindRow
										key={entry.id}
										entry={entry}
										isCapturing={capturing === entry.id}
										onStartCapture={() => {
											setConflict(null)
											setCapturing(capturing === entry.id ? null : entry.id)
										}}
										onReset={() => resetKeybind(entry.id)}
									/>
								))}
							</div>
						</div>
					)
				})}
			</div>

			{/* Empty state */}
			{filter && !hasResults && (
				<div className="py-12 text-center">
					<p className="text-sm text-muted">No shortcuts matching</p>
					<p className="mt-1 text-sm font-medium text-foreground">"{filter}"</p>
				</div>
			)}
		</div>
	)
}

// ── Keybind Row ────────────────────────────────────────────────

function KeybindRow({
	entry,
	isCapturing,
	onStartCapture,
	onReset,
}: {
	entry: KeybindEntry
	isCapturing: boolean
	onStartCapture: () => void
	onReset: () => void
}) {
	const buttonRef = useRef<HTMLButtonElement>(null)

	// Auto-focus the button when entering capture mode
	useEffect(() => {
		if (isCapturing) buttonRef.current?.focus()
	}, [isCapturing])

	const parts = formatKeybindParts(entry.currentKeybind)
	const isDisabled = entry.currentKeybind === "none"

	return (
		<div className="flex items-center justify-between gap-6 px-5 py-3.5">
			<div className="min-w-0">
				<div className="text-sm font-medium text-foreground">{entry.title}</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{/* Reset button for overridden entries */}
				{entry.isOverridden && !isCapturing && (
					<Tooltip content="Reset to default">
						<button
							type="button"
							onClick={onReset}
							className="el-surface-hover flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:text-foreground"
						>
							<ArrowRotateCcw className="h-3 w-3" aria-hidden="true" />
						</button>
					</Tooltip>
				)}

				{/* Keybind button */}
				<button
					ref={buttonRef}
					type="button"
					onClick={onStartCapture}
					className={cn(
						"flex h-8 min-w-[88px] items-center justify-center gap-1 rounded-lg px-3 text-xs font-medium transition-all",
						isCapturing
							? "border border-accent/50 bg-accent/10 text-accent animate-pulse"
							: entry.isOverridden
								? "border border-accent/30 bg-accent/5 text-foreground hover:bg-accent/10"
								: "border border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground",
					)}
				>
					{isCapturing ? (
						<span className="text-accent">Press keys...</span>
					) : isDisabled ? (
						<span className="text-muted italic">Unassigned</span>
					) : (
						parts.map((part) => (
							<kbd
								key={part}
								className={cn(
									"inline-flex h-5 min-w-[22px] items-center justify-center",
									"rounded px-1.5 font-mono text-[11px] leading-none text-muted-foreground",
									"shadow-[var(--shadow-inset)]",
								)}
							>
								{part}
							</kbd>
						))
					)}
				</button>
			</div>
		</div>
	)
}

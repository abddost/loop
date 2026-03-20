import type { ProviderInfo } from "@core/schema/provider"
import { CheckIcon, ChevronDownIcon, Square3Stack3DIcon } from "@heroicons/react/24/outline"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "../ui/cn"

export interface ModelSelectorProps {
	providers: ProviderInfo[]
	selectedProviderId?: string
	selectedModelId?: string
	onSelect: (modelId: string, providerId: string) => void
	className?: string
	/** Which direction the popover opens. Default "up" for chat bar. */
	direction?: "up" | "down"
	placeholder?: string
	/** Show an extra option at the top of the list (e.g. "Auto"). */
	extraOption?: { label: string; value: string }
}

interface FlatItem {
	modelId: string
	providerId: string
	name: string
}

/**
 * Fast model selector using a lightweight popover with search.
 *
 * Unlike the HeroUI Select which renders ALL items into the DOM upfront,
 * this only mounts the list when opened and filters via search — so it
 * stays fast even with hundreds of models.
 */
export function ModelSelector({
	providers,
	selectedProviderId,
	selectedModelId,
	onSelect,
	className,
	direction = "up",
	placeholder = "Select model",
	extraOption,
}: ModelSelectorProps) {
	const [open, setOpen] = useState(false)
	const [search, setSearch] = useState("")
	const [highlightIdx, setHighlightIdx] = useState(0)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const scrollRef = useRef<HTMLDivElement>(null)

	// Find selected model name for trigger label
	const selectedLabel = useMemo(() => {
		if (extraOption && !selectedProviderId && !selectedModelId) return extraOption.label
		if (!selectedProviderId || !selectedModelId) return null
		for (const p of providers) {
			if (p.id === selectedProviderId) {
				const m = p.models.find((model) => model.id === selectedModelId)
				if (m) return m.name
			}
		}
		return null
	}, [providers, selectedProviderId, selectedModelId, extraOption])

	// Filter providers and models by search
	const filtered = useMemo(() => {
		const q = search.toLowerCase().trim()
		if (!q) return providers.filter((p) => p.models.length > 0)
		return providers
			.map((p) => ({
				...p,
				models: p.models.filter(
					(m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
				),
			}))
			.filter((p) => p.models.length > 0)
	}, [providers, search])

	// Only show extra option when not searching
	const showExtra = !!extraOption && !search

	// Flat list of all visible items for keyboard navigation
	const flatItems = useMemo(() => {
		const items: FlatItem[] = []
		if (showExtra && extraOption) {
			items.push({ modelId: "", providerId: "", name: extraOption.label })
		}
		for (const p of filtered) {
			for (const m of p.models) {
				items.push({ modelId: m.id, providerId: p.id, name: m.name })
			}
		}
		return items
	}, [filtered, showExtra, extraOption])

	// Reset highlight when filtered items change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset on item count change
	useEffect(() => {
		setHighlightIdx(0)
	}, [flatItems.length])

	// Close on outside click
	useEffect(() => {
		if (!open) return
		const handler = (e: MouseEvent) => {
			if (
				triggerRef.current?.contains(e.target as Node) ||
				panelRef.current?.contains(e.target as Node)
			)
				return
			setOpen(false)
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [open])

	// Focus search input when opening
	useEffect(() => {
		if (open) {
			requestAnimationFrame(() => inputRef.current?.focus())
		} else {
			setSearch("")
			setHighlightIdx(0)
		}
	}, [open])

	const handleSelect = useCallback(
		(modelId: string, providerId: string) => {
			onSelect(modelId, providerId)
			setOpen(false)
		},
		[onSelect],
	)

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				setOpen(false)
				return
			}
			if (e.key === "ArrowDown") {
				e.preventDefault()
				setHighlightIdx((prev) => {
					const next = Math.min(prev + 1, flatItems.length - 1)
					scrollToItem(scrollRef.current, next)
					return next
				})
				return
			}
			if (e.key === "ArrowUp") {
				e.preventDefault()
				setHighlightIdx((prev) => {
					const next = Math.max(prev - 1, 0)
					scrollToItem(scrollRef.current, next)
					return next
				})
				return
			}
			if (e.key === "Enter") {
				e.preventDefault()
				const item = flatItems[highlightIdx]
				if (!item) return
				handleSelect(item.modelId, item.providerId)
			}
		},
		[flatItems, highlightIdx, handleSelect],
	)

	// Calculate panel position using fixed positioning
	const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
	useEffect(() => {
		if (!open || !triggerRef.current) return
		const rect = triggerRef.current.getBoundingClientRect()
		const minW = Math.max(rect.width, 280)
		if (direction === "up") {
			setPanelStyle({
				position: "fixed",
				bottom: window.innerHeight - rect.top + 4,
				left: rect.left,
				minWidth: minW,
				maxWidth: 400,
				zIndex: 50,
			})
		} else {
			setPanelStyle({
				position: "fixed",
				top: rect.bottom + 4,
				left: rect.left,
				minWidth: minW,
				maxWidth: 400,
				zIndex: 50,
			})
		}
	}, [open, direction])

	// Track flat-item index across grouped rendering
	let itemCounter = showExtra ? 1 : 0

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen(!open)}
				className={cn(
					"flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground",
					className,
				)}
			>
				<Square3Stack3DIcon className="w-3.5 h-3.5" aria-hidden="true" />
				<span className="max-w-[160px] truncate">{selectedLabel ?? placeholder}</span>
				<ChevronDownIcon className="w-2.5 h-2.5" aria-hidden="true" />
			</button>

			{open &&
				createPortal(
					<div
						ref={panelRef}
						style={panelStyle}
						className="rounded-xl border border-border bg-surface shadow-lg"
						onKeyDown={handleKeyDown}
					>
						{/* Search */}
						<div className="border-b border-border px-3 py-2">
							<input
								ref={inputRef}
								type="text"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search models..."
								className="w-full bg-transparent text-sm text-foreground placeholder:text-placeholder outline-none"
							/>
						</div>

						{/* Model list */}
						<div ref={scrollRef} className="max-h-[300px] overflow-y-auto py-1">
							{/* Extra option (e.g. "Auto") */}
							{showExtra && extraOption && (
								<button
									type="button"
									onClick={() => handleSelect("", "")}
									onMouseEnter={() => setHighlightIdx(0)}
									className={cn(
										"flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors",
										highlightIdx === 0
											? "bg-surface-hover text-foreground"
											: "text-foreground/80 hover:bg-surface-hover",
									)}
								>
									{extraOption.label}
								</button>
							)}

							{filtered.length === 0 && (
								<div className="px-3 py-6 text-center text-sm text-muted">No models found</div>
							)}

							{filtered.map((provider) => (
								<div key={provider.id}>
									<div className="sticky top-0 bg-surface px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
										{provider.name}
									</div>
									{provider.models.map((model) => {
										const idx = itemCounter++
										return (
											<button
												key={`${provider.id}:${model.id}`}
												type="button"
												onClick={() => handleSelect(model.id, provider.id)}
												onMouseEnter={() => setHighlightIdx(idx)}
												data-item-idx={idx}
												className={cn(
													"flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors",
													idx === highlightIdx
														? "bg-surface-hover text-foreground"
														: "text-foreground/80 hover:bg-surface-hover",
													model.id === selectedModelId &&
														provider.id === selectedProviderId &&
														"font-medium text-accent",
												)}
											>
												<span className="truncate">{model.name}</span>
												{model.id === selectedModelId && provider.id === selectedProviderId && (
													<CheckIcon
														className="w-3.5 h-3.5 shrink-0 text-accent"
														aria-hidden="true"
													/>
												)}
											</button>
										)
									})}
								</div>
							))}
						</div>
					</div>,
					document.body,
				)}
		</>
	)
}

/** Scroll a highlighted item into view within the scroll container. */
function scrollToItem(container: HTMLDivElement | null, idx: number) {
	if (!container) return
	const el = container.querySelector(`[data-item-idx="${idx}"]`)
	el?.scrollIntoView({ block: "nearest" })
}

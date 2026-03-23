import type { ModelInfo, ProviderInfo } from "@core/schema/provider"
import { Check, ChevronDown, SettingsCog, Stack } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
	CURSOR_MODES,
	CURSOR_PROVIDER_ID,
	detectTier,
	resolveModelForTier,
} from "../../lib/cursor-tiers"
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
	/** Navigate to settings models tab. */
	onManageModels?: () => void
}

interface FlatItem {
	modelId: string
	providerId: string
	name: string
}

// ─── Capability badge helpers ───────────────────────────────

function modelBadges(model: ModelInfo): Array<{ label: string; style: string }> {
	const badges: Array<{ label: string; style: string }> = []
	if (model.supportsReasoning) {
		badges.push({ label: "R", style: "bg-purple-500/20 text-purple-400" })
	}
	if (model.supportsImages) {
		badges.push({ label: "V", style: "bg-blue-500/20 text-blue-400" })
	}
	if (model.pricing.input === 0 && model.pricing.output === 0) {
		badges.push({ label: "Free", style: "bg-success/20 text-success" })
	}
	return badges
}

/**
 * Fast model selector using a lightweight popover with search.
 *
 * Includes provider grouping, capability badges, context window info,
 * and a "Manage Models" link to settings.
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
	onManageModels,
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

	// Filter providers and models by search (matches provider name, model name, and model ID)
	const filtered = useMemo(() => {
		const q = search.toLowerCase().trim()
		if (!q) return providers.filter((p) => p.models.length > 0)
		return providers
			.map((p) => ({
				...p,
				models: p.models.filter(
					(m) =>
						m.name.toLowerCase().includes(q) ||
						m.id.toLowerCase().includes(q) ||
						p.name.toLowerCase().includes(q),
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
		const minW = Math.max(rect.width, 320)
		if (direction === "up") {
			setPanelStyle({
				position: "fixed",
				bottom: window.innerHeight - rect.top + 4,
				left: rect.left,
				minWidth: minW,
				maxWidth: 420,
				zIndex: 50,
			})
		} else {
			setPanelStyle({
				position: "fixed",
				top: rect.bottom + 4,
				left: rect.left,
				minWidth: minW,
				maxWidth: 420,
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
				<Stack className="w-3.5 h-3.5" aria-hidden="true" />
				<span className="max-w-[160px] truncate">{selectedLabel ?? placeholder}</span>
				<ChevronDown className="w-2.5 h-2.5" aria-hidden="true" />
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
								placeholder="Search models or providers..."
								className="w-full bg-transparent text-sm text-foreground placeholder:text-placeholder outline-none"
							/>
						</div>

						{/* Cursor mode quick-select */}
						<CursorModes
							providers={providers}
							selectedProviderId={selectedProviderId}
							selectedModelId={selectedModelId}
							search={search}
							onSelect={handleSelect}
						/>

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
										const isSelected =
											model.id === selectedModelId && provider.id === selectedProviderId
										const badges = modelBadges(model)
										return (
											<button
												key={`${provider.id}:${model.id}`}
												type="button"
												onClick={() => handleSelect(model.id, provider.id)}
												onMouseEnter={() => setHighlightIdx(idx)}
												data-item-idx={idx}
												className={cn(
													"flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors",
													idx === highlightIdx
														? "bg-surface-hover text-foreground"
														: "text-foreground/80 hover:bg-surface-hover",
													isSelected && "font-medium text-accent",
												)}
											>
												<div className="flex min-w-0 items-center gap-1.5">
													<span className="truncate">{model.name}</span>
													{badges.map((b) => (
														<span
															key={b.label}
															className={cn(
																"shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none",
																b.style,
															)}
														>
															{b.label}
														</span>
													))}
												</div>
												<div className="flex shrink-0 items-center gap-1.5">
													<span className="text-[10px] text-muted">
														{formatContextWindow(model.contextWindow)}
													</span>
													{isSelected && (
														<Check
															className="w-3.5 h-3.5 shrink-0 text-accent"
															aria-hidden="true"
														/>
													)}
												</div>
											</button>
										)
									})}
								</div>
							))}
						</div>

						{/* Manage Models link */}
						{onManageModels && (
							<div className="border-t border-border px-3 py-1.5">
								<button
									type="button"
									onClick={() => {
										setOpen(false)
										onManageModels()
									}}
									className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
								>
									<SettingsCog className="h-3 w-3" aria-hidden="true" />
									Manage models
								</button>
							</div>
						)}
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

/** Format context window size for display in the selector. */
function formatContextWindow(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
	return String(n)
}

// ─── Cursor mode quick-select ──────────────────────────────

interface CursorModesProps {
	providers: ProviderInfo[]
	selectedProviderId?: string
	selectedModelId?: string
	search: string
	onSelect: (modelId: string, providerId: string) => void
}

/**
 * Cursor-specific tier buttons shown at the top of the model popover.
 * Renders only when Cursor is the active provider and search is empty.
 */
function CursorModes({
	providers,
	selectedProviderId,
	selectedModelId,
	search,
	onSelect,
}: CursorModesProps) {
	const cursorProvider = useMemo(() => {
		if (selectedProviderId !== CURSOR_PROVIDER_ID) return null
		return providers.find((p) => p.id === CURSOR_PROVIDER_ID) ?? null
	}, [providers, selectedProviderId])

	const activeTier = useMemo(() => {
		if (!cursorProvider || !selectedModelId) return null
		return detectTier(selectedModelId)
	}, [cursorProvider, selectedModelId])

	if (!cursorProvider || search) return null

	return (
		<div className="border-b border-border px-3 py-2">
			<div className="mb-1.5 flex items-center gap-1.5">
				<span className="text-[11px] font-medium uppercase tracking-wider text-muted">
					Cursor Modes
				</span>
				<span
					className="inline-flex h-3.5 w-3.5 cursor-default items-center justify-center rounded-full border border-border text-[9px] text-muted"
					title="Quick-select Cursor subscription model tiers"
				>
					?
				</span>
			</div>
			<div className="flex gap-1.5">
				{CURSOR_MODES.map((mode) => {
					const resolved = resolveModelForTier(mode.tier, cursorProvider.models)
					const isActive = activeTier === mode.tier
					const isMax = mode.tier === "max"
					const disabled = resolved === null

					return (
						<button
							key={mode.tier}
							type="button"
							disabled={disabled}
							onClick={() => {
								if (resolved) onSelect(resolved, CURSOR_PROVIDER_ID)
							}}
							className={cn(
								"flex flex-1 flex-col items-center rounded-lg border px-2 py-1.5 text-xs transition-colors",
								disabled && "cursor-not-allowed opacity-40",
								!disabled && !isActive && "border-border text-muted hover:bg-surface-hover",
								isActive && !isMax && "border-accent/30 bg-accent/15 text-accent",
								isActive && isMax && "border-purple-500/30 bg-purple-500/15 text-purple-400",
							)}
						>
							<span className="font-medium leading-tight">{mode.label}</span>
							<span className="text-[10px] leading-tight opacity-70">{mode.hint}</span>
						</button>
					)
				})}
			</div>
		</div>
	)
}

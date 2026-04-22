import type { ModelInfo, ProviderInfo } from "@core/schema/provider"
import { Check, ChevronDown, SettingsCog, Stack } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
	CURSOR_MODES,
	CURSOR_PROVIDER_ID,
	detectTier,
	findTierVariantInFamily,
	resolveModelForTier,
} from "../../lib/cursor-tiers"
import { formatTokens } from "../settings/shared"
import { cn } from "../ui/cn"
import { ProviderIcon } from "../ui/provider-icon"
import { Tooltip } from "../ui/tooltip"

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

type FocusZone = "providers" | "models"

interface FlatItem {
	modelId: string
	providerId: string
	model?: ModelInfo
	// Empty modelId + providerId = "extra" option (e.g. "Auto")
	name: string
}

/**
 * Two-level model selector. Matches the pattern in the product design:
 *
 *   [ Search ]
 *   ┌────────────┬─────────────────────┐
 *   │ Provider A │ (provider A models) │
 *   │ Provider B │                     │
 *   └────────────┴─────────────────────┘
 *   [ Manage models ]
 *
 * When the search box has content, the view collapses to a flat cross-provider
 * result list. When empty, left column lists providers and the right column
 * shows the active provider's models. For Cursor, the right column is
 * preceded by the MAX Mode toggle + Auto/Premium tier shortcuts.
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
	const [flatHighlightIdx, setFlatHighlightIdx] = useState(0)
	const [focusZone, setFocusZone] = useState<FocusZone>("providers")
	const [modelHighlightIdx, setModelHighlightIdx] = useState(0)

	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const flyoutRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const providerScrollRef = useRef<HTMLDivElement>(null)
	const modelScrollRef = useRef<HTMLDivElement>(null)

	const availableProviders = useMemo(
		() => providers.filter((p) => p.models.length > 0),
		[providers],
	)

	const selectedProvider = useMemo(() => {
		if (!selectedProviderId) return null
		return providers.find((p) => p.id === selectedProviderId) ?? null
	}, [providers, selectedProviderId])

	const selectedLabel = useMemo(() => {
		if (extraOption && !selectedProviderId && !selectedModelId) return extraOption.label
		if (!selectedProviderId || !selectedModelId) return null
		if (selectedProvider) {
			const m = selectedProvider.models.find((model) => model.id === selectedModelId)
			if (m) return m.name
		}
		return null
	}, [selectedProvider, selectedProviderId, selectedModelId, extraOption])

	// Which provider's submenu is showing on the right column. Initialized to
	// the selected provider so the user's current choice is visible immediately.
	//
	// IMPORTANT: this effect runs only on open-transition — not on every
	// parent re-render — otherwise `availableProviders` (derived from a prop
	// that may be a fresh reference each render) resets state continuously,
	// causing hover flicker while the dropdown is open.
	const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		if (!open) return
		const initial =
			selectedProviderId && availableProviders.some((p) => p.id === selectedProviderId)
				? selectedProviderId
				: (availableProviders[0]?.id ?? null)
		setActiveProviderId(initial)
		setModelHighlightIdx(0)
		setFocusZone("providers")
	}, [open])

	const activeProvider = useMemo(
		() => availableProviders.find((p) => p.id === activeProviderId) ?? null,
		[availableProviders, activeProviderId],
	)

	// ─── Search (flat) ──────────────────────────────────────────────
	const isSearching = search.trim().length > 0

	const flatResults = useMemo(() => {
		if (!isSearching) return []
		const q = search.toLowerCase().trim()
		const groups: Array<{ provider: ProviderInfo; models: ModelInfo[] }> = []
		for (const p of availableProviders) {
			const matched = p.models.filter(
				(m) =>
					m.name.toLowerCase().includes(q) ||
					m.id.toLowerCase().includes(q) ||
					p.name.toLowerCase().includes(q),
			)
			if (matched.length > 0) groups.push({ provider: p, models: matched })
		}
		return groups
	}, [availableProviders, search, isSearching])

	const showExtra = !!extraOption && !isSearching

	const flatItems = useMemo(() => {
		const items: FlatItem[] = []
		if (showExtra && extraOption) {
			items.push({ modelId: "", providerId: "", name: extraOption.label })
		}
		for (const group of flatResults) {
			for (const m of group.models) {
				items.push({
					modelId: m.id,
					providerId: group.provider.id,
					model: m,
					name: m.name,
				})
			}
		}
		return items
	}, [flatResults, showExtra, extraOption])

	useEffect(() => {
		setFlatHighlightIdx(0)
	}, [])

	// ─── Close on outside click ─────────────────────────────────────
	useEffect(() => {
		if (!open) return
		const handler = (e: MouseEvent) => {
			if (
				triggerRef.current?.contains(e.target as Node) ||
				panelRef.current?.contains(e.target as Node) ||
				flyoutRef.current?.contains(e.target as Node)
			)
				return
			setOpen(false)
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [open])

	// ─── Tooltip (hover over model row) ─────────────────────────────
	const [tooltipData, setTooltipData] = useState<{
		model: ModelInfo
		top: number
		left: number
	} | null>(null)
	const [tooltipVisible, setTooltipVisible] = useState(false)
	const tooltipActiveRef = useRef(false)
	const showTimer = useRef<ReturnType<typeof setTimeout>>(null)
	const hideTimer = useRef<ReturnType<typeof setTimeout>>(null)
	const unmountTimer = useRef<ReturnType<typeof setTimeout>>(null)
	const isKeyNav = useRef(false)

	const showTooltip = useCallback((model: ModelInfo, el: HTMLElement) => {
		if (isKeyNav.current) return
		if (hideTimer.current) {
			clearTimeout(hideTimer.current)
			hideTimer.current = null
		}
		if (unmountTimer.current) {
			clearTimeout(unmountTimer.current)
			unmountTimer.current = null
		}
		if (showTimer.current) {
			clearTimeout(showTimer.current)
			showTimer.current = null
		}

		const update = () => {
			const rect = el.getBoundingClientRect()
			// Prefer the flyout's right edge when available (that's where model
			// rows live); fall back to the main panel when searching.
			const anchor = flyoutRef.current ?? panelRef.current
			const anchorRect = anchor?.getBoundingClientRect()
			if (!anchorRect) return
			setTooltipData({ model, top: rect.top, left: anchorRect.right + 8 })
			setTooltipVisible(true)
			tooltipActiveRef.current = true
		}

		if (tooltipActiveRef.current) update()
		else showTimer.current = setTimeout(update, 200)
	}, [])

	const hideTooltip = useCallback(() => {
		if (showTimer.current) {
			clearTimeout(showTimer.current)
			showTimer.current = null
		}
		if (hideTimer.current) clearTimeout(hideTimer.current)
		hideTimer.current = setTimeout(() => {
			setTooltipVisible(false)
			tooltipActiveRef.current = false
			unmountTimer.current = setTimeout(() => setTooltipData(null), 150)
		}, 75)
	}, [])

	const clearTooltip = useCallback(() => {
		if (showTimer.current) clearTimeout(showTimer.current)
		if (hideTimer.current) clearTimeout(hideTimer.current)
		if (unmountTimer.current) clearTimeout(unmountTimer.current)
		setTooltipVisible(false)
		setTooltipData(null)
		tooltipActiveRef.current = false
	}, [])

	// ─── Focus + reset on open/close ────────────────────────────────
	useEffect(() => {
		if (open) {
			requestAnimationFrame(() => inputRef.current?.focus())
		} else {
			setSearch("")
			setFlatHighlightIdx(0)
			clearTooltip()
		}
	}, [open, clearTooltip])

	// ─── Select handlers ────────────────────────────────────────────
	const handleSelect = useCallback(
		(modelId: string, providerId: string) => {
			onSelect(modelId, providerId)
			clearTooltip()
			setOpen(false)
		},
		[onSelect, clearTooltip],
	)

	// ─── Keyboard navigation ────────────────────────────────────────
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				setOpen(false)
				return
			}

			// Search-mode: flat navigation over flatItems.
			if (isSearching) {
				if (e.key === "ArrowDown") {
					e.preventDefault()
					isKeyNav.current = true
					clearTooltip()
					setFlatHighlightIdx((prev) => {
						const next = Math.min(prev + 1, flatItems.length - 1)
						scrollToItem(providerScrollRef.current, `flat-${next}`)
						return next
					})
					return
				}
				if (e.key === "ArrowUp") {
					e.preventDefault()
					isKeyNav.current = true
					clearTooltip()
					setFlatHighlightIdx((prev) => {
						const next = Math.max(prev - 1, 0)
						scrollToItem(providerScrollRef.current, `flat-${next}`)
						return next
					})
					return
				}
				if (e.key === "Enter") {
					e.preventDefault()
					const item = flatItems[flatHighlightIdx]
					if (!item) return
					handleSelect(item.modelId, item.providerId)
				}
				return
			}

			// Nested mode. Two zones — providers and models.
			if (focusZone === "providers") {
				const currentIdx = availableProviders.findIndex((p) => p.id === activeProviderId)
				if (e.key === "ArrowDown") {
					e.preventDefault()
					isKeyNav.current = true
					const next = Math.min(
						(currentIdx < 0 ? -1 : currentIdx) + 1,
						availableProviders.length - 1,
					)
					const p = availableProviders[next]
					if (p) {
						setActiveProviderId(p.id)
						scrollToItem(providerScrollRef.current, `p-${next}`)
					}
					return
				}
				if (e.key === "ArrowUp") {
					e.preventDefault()
					isKeyNav.current = true
					const next = Math.max((currentIdx < 0 ? 0 : currentIdx) - 1, 0)
					const p = availableProviders[next]
					if (p) {
						setActiveProviderId(p.id)
						scrollToItem(providerScrollRef.current, `p-${next}`)
					}
					return
				}
				if (e.key === "ArrowRight" || e.key === "Tab" || e.key === "Enter") {
					if (!activeProvider || activeProvider.models.length === 0) return
					e.preventDefault()
					isKeyNav.current = true
					setFocusZone("models")
					setModelHighlightIdx(0)
					return
				}
			} else {
				if (e.key === "ArrowDown") {
					e.preventDefault()
					isKeyNav.current = true
					clearTooltip()
					setModelHighlightIdx((prev) => {
						const max = (activeProvider?.models.length ?? 1) - 1
						const next = Math.min(prev + 1, max)
						scrollToItem(modelScrollRef.current, `m-${next}`)
						return next
					})
					return
				}
				if (e.key === "ArrowUp") {
					e.preventDefault()
					isKeyNav.current = true
					clearTooltip()
					setModelHighlightIdx((prev) => {
						const next = Math.max(prev - 1, 0)
						scrollToItem(modelScrollRef.current, `m-${next}`)
						return next
					})
					return
				}
				if (e.key === "ArrowLeft") {
					e.preventDefault()
					isKeyNav.current = true
					clearTooltip()
					setFocusZone("providers")
					return
				}
				if (e.key === "Enter") {
					e.preventDefault()
					const m = activeProvider?.models[modelHighlightIdx]
					if (m && activeProvider) handleSelect(m.id, activeProvider.id)
				}
			}
		},
		[
			isSearching,
			flatItems,
			flatHighlightIdx,
			focusZone,
			availableProviders,
			activeProvider,
			activeProviderId,
			modelHighlightIdx,
			handleSelect,
			clearTooltip,
		],
	)

	// ─── Panel positioning ──────────────────────────────────────────
	// Main panel holds search + provider list. Flyout is a *separate* portal
	// positioned to the right of the main panel; it renders outside the main
	// panel's DOM subtree so provider-hover state can't reflow the models
	// panel (and vice versa). Keeping them on separate React roots is what
	// eliminates the cross-column flicker.
	const PANEL_WIDTH = 180
	const FLYOUT_WIDTH = 260
	const FLYOUT_GAP = 4
	const PANEL_WIDE_WIDTH = 420 // used when searching (flat results need space)
	const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
	const [flyoutStyle, setFlyoutStyle] = useState<React.CSSProperties>({})
	useLayoutEffect(() => {
		if (!open || !triggerRef.current) return
		const rect = triggerRef.current.getBoundingClientRect()
		const width = isSearching ? PANEL_WIDE_WIDTH : PANEL_WIDTH
		const panelLeft = Math.max(
			8,
			Math.min(rect.left, window.innerWidth - width - FLYOUT_WIDTH - FLYOUT_GAP - 8),
		)
		const panelBase: React.CSSProperties = {
			position: "fixed",
			left: panelLeft,
			width,
			zIndex: 50,
		}
		if (direction === "up") {
			setPanelStyle({ ...panelBase, bottom: window.innerHeight - rect.top + 4 })
			setFlyoutStyle({
				position: "fixed",
				left: panelLeft + width + FLYOUT_GAP,
				bottom: window.innerHeight - rect.top + 4,
				width: FLYOUT_WIDTH,
				zIndex: 50,
			})
		} else {
			setPanelStyle({ ...panelBase, top: rect.bottom + 4 })
			setFlyoutStyle({
				position: "fixed",
				left: panelLeft + width + FLYOUT_GAP,
				top: rect.bottom + 4,
				width: FLYOUT_WIDTH,
				zIndex: 50,
			})
		}
	}, [open, direction, isSearching])

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen(!open)}
				className={cn(
					"flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-muted transition-colors hover:bg-surface-hover hover:text-foreground",
					className,
				)}
			>
				{selectedProvider ? (
					<ProviderIcon
						providerId={selectedProvider.id}
						providerName={selectedProvider.name}
						size="xs"
						className="shrink-0"
					/>
				) : (
					<Stack className="w-3 h-3" aria-hidden="true" />
				)}
				<span className="max-w-[100px] truncate">{selectedLabel ?? placeholder}</span>
				<ChevronDown className="w-2 h-2" aria-hidden="true" />
			</button>

			{open &&
				createPortal(
					<div ref={panelRef} style={panelStyle} className="el-dropdown" onKeyDown={handleKeyDown}>
						{/* Search */}
						<div className="px-3 pt-2.5 pb-1.5">
							<input
								ref={inputRef}
								type="text"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search models..."
								className="w-full bg-transparent text-sm text-foreground placeholder:text-placeholder outline-none"
							/>
						</div>

						{isSearching ? (
							<FlatResults
								items={flatItems}
								flatResults={flatResults}
								extraOption={showExtra ? extraOption : undefined}
								selectedProviderId={selectedProviderId}
								selectedModelId={selectedModelId}
								highlightIdx={flatHighlightIdx}
								onHighlight={(idx) => {
									isKeyNav.current = false
									setFlatHighlightIdx(idx)
								}}
								onSelect={handleSelect}
								onShowTooltip={showTooltip}
								onHideTooltip={hideTooltip}
								scrollRef={providerScrollRef}
							/>
						) : (
							<div className="border-t border-[var(--separator)]">
								<ProviderColumn
									ref={providerScrollRef}
									providers={availableProviders}
									activeProviderId={activeProviderId}
									onActivate={(idx) => {
										const p = availableProviders[idx]
										if (!p) return
										if (p.id === activeProviderId) return
										isKeyNav.current = false
										setActiveProviderId(p.id)
										setModelHighlightIdx(0)
									}}
									onEnterSubmenu={() => {
										if (!activeProvider || activeProvider.models.length === 0) return
										isKeyNav.current = false
										setFocusZone("models")
										setModelHighlightIdx(0)
									}}
								/>
							</div>
						)}

						{/* Manage Models link */}
						{onManageModels && (
							<div className="border-t border-[var(--separator)] px-3 py-1.5">
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

			{/* Models flyout — separate portal so hovering providers cannot
			    reflow its contents, and vice versa. */}
			{open &&
				!isSearching &&
				activeProvider &&
				createPortal(
					<div
						ref={flyoutRef}
						style={flyoutStyle}
						className="el-dropdown"
						onKeyDown={handleKeyDown}
					>
						<ProviderSubmenu
							ref={modelScrollRef}
							provider={activeProvider}
							providers={availableProviders}
							selectedProviderId={selectedProviderId}
							selectedModelId={selectedModelId}
							highlightIdx={focusZone === "models" ? modelHighlightIdx : -1}
							onHighlight={(idx) => {
								isKeyNav.current = false
								setFocusZone("models")
								setModelHighlightIdx(idx)
							}}
							onSelect={handleSelect}
							onShowTooltip={showTooltip}
							onHideTooltip={hideTooltip}
						/>
					</div>,
					document.body,
				)}

			{/* Model detail tooltip */}
			{tooltipData &&
				createPortal(
					<ModelTooltip
						model={tooltipData.model}
						style={{ top: tooltipData.top, left: tooltipData.left }}
						visible={tooltipVisible}
					/>,
					document.body,
				)}
		</>
	)
}

// ─── Flat search results ─────────────────────────────────────────

interface FlatResultsProps {
	items: FlatItem[]
	flatResults: Array<{ provider: ProviderInfo; models: ModelInfo[] }>
	extraOption?: { label: string; value: string }
	selectedProviderId?: string
	selectedModelId?: string
	highlightIdx: number
	onHighlight: (idx: number) => void
	onSelect: (modelId: string, providerId: string) => void
	onShowTooltip: (model: ModelInfo, el: HTMLElement) => void
	onHideTooltip: () => void
	scrollRef: React.RefObject<HTMLDivElement | null>
}

function FlatResults({
	items,
	flatResults,
	extraOption,
	selectedProviderId,
	selectedModelId,
	highlightIdx,
	onHighlight,
	onSelect,
	onShowTooltip,
	onHideTooltip,
	scrollRef,
}: FlatResultsProps) {
	let cursor = 0
	return (
		<div ref={scrollRef} className="max-h-[320px] overflow-y-auto pb-1.5">
			{extraOption &&
				(() => {
					const idx = cursor++
					return (
						<button
							key="__extra__"
							type="button"
							onClick={() => onSelect("", "")}
							onMouseEnter={() => onHighlight(idx)}
							data-item-id={`flat-${idx}`}
							className={cn(
								"flex w-full items-center px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-[var(--app-surface-hover)]",
								idx === highlightIdx && "bg-[var(--app-surface-hover)]",
							)}
						>
							{extraOption.label}
						</button>
					)
				})()}
			{items.length === 0 && !extraOption && (
				<div className="px-3 py-6 text-center text-sm text-muted">No models found</div>
			)}
			{flatResults.map((group, groupIdx) => (
				<div key={group.provider.id}>
					<div className={cn("px-3 pb-0.5 text-[10px] text-muted", groupIdx > 0 && "pt-2")}>
						{group.provider.name}
					</div>
					{group.models.map((model) => {
						const idx = cursor++
						const isSelected =
							model.id === selectedModelId && group.provider.id === selectedProviderId
						return (
							<button
								key={`${group.provider.id}:${model.id}`}
								type="button"
								onClick={() => onSelect(model.id, group.provider.id)}
								onMouseEnter={(e) => {
									onHighlight(idx)
									onShowTooltip(model, e.currentTarget)
								}}
								onMouseLeave={onHideTooltip}
								data-item-id={`flat-${idx}`}
								className={cn(
									"flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-[var(--app-surface-hover)]",
									idx === highlightIdx && "bg-[var(--app-surface-hover)]",
									isSelected && "font-medium",
								)}
							>
								<span className="truncate">{model.name}</span>
								{isSelected && (
									<Check className="w-3.5 h-3.5 shrink-0 text-muted" aria-hidden="true" />
								)}
							</button>
						)
					})}
				</div>
			))}
		</div>
	)
}

// ─── Provider column (left) ──────────────────────────────────────

interface ProviderColumnProps {
	providers: ProviderInfo[]
	activeProviderId: string | null
	onActivate: (idx: number) => void
	onEnterSubmenu: () => void
}

const ProviderColumn = ({
	ref,
	providers,
	activeProviderId,
	onActivate,
	onEnterSubmenu,
}: ProviderColumnProps & { ref?: React.Ref<HTMLDivElement | null> }) => (
	<div ref={ref} className="max-h-[320px] min-h-[160px] overflow-y-auto py-1">
		{providers.map((p, idx) => {
			const isActive = p.id === activeProviderId
			return (
				<button
					key={p.id}
					type="button"
					onClick={() => {
						onActivate(idx)
						onEnterSubmenu()
					}}
					onMouseEnter={() => onActivate(idx)}
					data-item-id={`p-${idx}`}
					className={cn(
						"flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-[var(--app-surface-hover)]",
						isActive && "bg-[var(--app-surface-hover)]",
					)}
				>
					<ProviderIcon providerId={p.id} providerName={p.name} size="xs" className="shrink-0" />
					<span className="flex-1 truncate">{p.name}</span>
					<ChevronDown
						className="h-2.5 w-2.5 -rotate-90 text-muted opacity-50"
						aria-hidden="true"
					/>
				</button>
			)
		})}
	</div>
)

// ─── Submenu column (right) ──────────────────────────────────────

interface ProviderSubmenuProps {
	provider: ProviderInfo
	providers: ProviderInfo[]
	selectedProviderId?: string
	selectedModelId?: string
	highlightIdx: number
	onHighlight: (idx: number) => void
	onSelect: (modelId: string, providerId: string) => void
	onShowTooltip: (model: ModelInfo, el: HTMLElement) => void
	onHideTooltip: () => void
}

const ProviderSubmenu = ({
	ref,
	provider,
	providers,
	selectedProviderId,
	selectedModelId,
	highlightIdx,
	onHighlight,
	onSelect,
	onShowTooltip,
	onHideTooltip,
}: ProviderSubmenuProps & { ref?: React.Ref<HTMLDivElement | null> }) => {
	const isCursor = provider.id === CURSOR_PROVIDER_ID
	return (
		<div ref={ref} className="max-h-[320px] min-h-[160px] overflow-y-auto py-1">
			{isCursor && (
				<CursorModes
					providers={providers}
					selectedProviderId={selectedProviderId}
					selectedModelId={selectedModelId}
					onSelect={onSelect}
				/>
			)}
			{provider.models.length === 0 ? (
				<div className="px-3 py-6 text-center text-sm text-muted">No models</div>
			) : (
				provider.models.map((model, idx) => {
					const isSelected = model.id === selectedModelId && provider.id === selectedProviderId
					return (
						<button
							key={model.id}
							type="button"
							onClick={() => onSelect(model.id, provider.id)}
							onMouseEnter={(e) => {
								onHighlight(idx)
								onShowTooltip(model, e.currentTarget)
							}}
							onMouseLeave={onHideTooltip}
							data-item-id={`m-${idx}`}
							className={cn(
								"flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-[var(--app-surface-hover)]",
								idx === highlightIdx && "bg-[var(--app-surface-hover)]",
								isSelected && "font-medium",
							)}
						>
							<span className="truncate">{model.name}</span>
							{isSelected && (
								<Check className="w-3.5 h-3.5 shrink-0 text-muted" aria-hidden="true" />
							)}
						</button>
					)
				})
			)}
		</div>
	)
}

// ─── Scroll helper ───────────────────────────────────────────────

function scrollToItem(container: HTMLDivElement | null, id: string) {
	if (!container) return
	const el = container.querySelector(`[data-item-id="${id}"]`)
	el?.scrollIntoView({ block: "nearest" })
}

// ─── Model detail tooltip ────────────────────────────────────────

function ModelTooltip({
	model,
	style,
	visible,
}: {
	model: ModelInfo
	style: { top: number; left: number }
	visible: boolean
}) {
	const capabilities: string[] = []
	if (model.supportsReasoning) capabilities.push("Reasoning")
	if (model.supportsImages) capabilities.push("Vision")
	if (model.supportsTools) capabilities.push("Tools")

	return (
		<div
			className="pointer-events-none el-dropdown px-3 py-2 transition-opacity duration-150 ease-out"
			style={{
				position: "fixed",
				top: style.top,
				left: style.left,
				width: 200,
				zIndex: 60,
				opacity: visible ? 1 : 0,
			}}
		>
			<div className="text-sm font-medium text-foreground">{model.name}</div>
			<div className="mt-1 text-xs text-muted">
				{formatTokens(model.contextWindow)} context
				{model.maxOutput > 0 && <> &middot; {formatTokens(model.maxOutput)} max output</>}
			</div>
			{capabilities.length > 0 && (
				<div className="mt-1 text-xs text-muted">{capabilities.join(" · ")}</div>
			)}
		</div>
	)
}

// ─── Cursor modes (MAX toggle + Auto/Premium) ────────────────────

interface CursorModesProps {
	providers: ProviderInfo[]
	selectedProviderId?: string
	selectedModelId?: string
	onSelect: (modelId: string, providerId: string) => void
}

/**
 * Cursor-specific controls pinned to the top of the cursor submenu.
 *
 *   [MAX Mode]   (toggle; swaps current model ↔ its -max variant)
 *   [ Auto ]  [ Premium ]   (radio; pick a model in that tier)
 *
 * MAX state is derived from the selected model id — no separate store field.
 */
function CursorModes({
	providers,
	selectedProviderId,
	selectedModelId,
	onSelect,
}: CursorModesProps) {
	const cursorProvider = useMemo(
		() => providers.find((p) => p.id === CURSOR_PROVIDER_ID) ?? null,
		[providers],
	)
	const isCursorActive = selectedProviderId === CURSOR_PROVIDER_ID
	const activeTier = useMemo(() => {
		if (!isCursorActive || !selectedModelId) return null
		return detectTier(selectedModelId)
	}, [isCursorActive, selectedModelId])

	const maxOn = activeTier === "max"
	const maxTarget = useMemo(() => {
		if (!cursorProvider || !selectedModelId || !isCursorActive) return null
		return findTierVariantInFamily(
			selectedModelId,
			maxOn ? "premium" : "max",
			cursorProvider.models,
		)
	}, [cursorProvider, selectedModelId, isCursorActive, maxOn])
	const maxDisabled = !isCursorActive || maxTarget === null || selectedModelId === "auto"

	if (!cursorProvider) return null

	return (
		<div className="border-b border-[var(--separator)] px-3 py-2">
			{/* MAX Mode toggle */}
			<div className="mb-2 flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<span className="text-xs font-medium text-foreground">MAX Mode</span>
					<Tooltip
						content="Use full context window, all tools, and maximum reasoning effort. Swaps to the -max variant of the current model family."
						side="top"
					>
						<span className="inline-flex h-3.5 w-3.5 cursor-default items-center justify-center rounded-full border border-border text-[9px] text-muted">
							?
						</span>
					</Tooltip>
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={maxOn}
					disabled={maxDisabled}
					onClick={() => {
						if (maxDisabled || !maxTarget) return
						onSelect(maxTarget, CURSOR_PROVIDER_ID)
					}}
					className={cn(
						"relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
						maxDisabled && "cursor-not-allowed opacity-40",
						!maxDisabled && maxOn && "bg-purple-500",
						!maxDisabled && !maxOn && "bg-[var(--separator)] hover:bg-[var(--app-surface-hover)]",
					)}
				>
					<span
						className={cn(
							"inline-block h-3 w-3 translate-x-0.5 transform rounded-full bg-white shadow transition-transform",
							maxOn && "translate-x-3.5",
						)}
					/>
				</button>
			</div>

			{/* Auto / Premium quick-select */}
			<div className="flex gap-1.5">
				{CURSOR_MODES.filter((m) => m.tier !== "max").map((mode) => {
					const resolved = resolveModelForTier(mode.tier, cursorProvider.models)
					const isActive = activeTier === mode.tier
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
								!disabled &&
									!isActive &&
									"border-[var(--separator)] text-muted hover:bg-[var(--app-surface-hover)]",
								isActive && "border-accent/30 bg-accent/15 text-accent",
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

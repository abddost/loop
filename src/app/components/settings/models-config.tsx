import type { ModelInfo, ProviderInfo } from "@core/schema/provider"
import { ChevronDown, ChevronUp } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { modelKey } from "../../lib/model-filter"
import { useConfigStore } from "../../stores/config-store"
import { useProviderStore } from "../../stores/provider-store"
import { cn } from "../ui/cn"
import { ProviderIcon } from "../ui/provider-icon"
import { ToggleSwitch, formatTokens } from "./shared"

const INITIAL_VISIBLE_COUNT = 20

// ─── Capability helpers ──────────────────────────────────────

function capabilityTags(model: ModelInfo): Array<{ label: string; style: string }> {
	const tags: Array<{ label: string; style: string }> = []
	if (model.supportsReasoning) {
		tags.push({ label: "Reasoning", style: "bg-purple-500/15 text-purple-400" })
	}
	if (model.supportsImages) {
		tags.push({ label: "Vision", style: "bg-blue-500/15 text-blue-400" })
	}
	if (model.supportsTools) {
		tags.push({ label: "Tools", style: "bg-amber-500/15 text-amber-400" })
	}
	if (model.modalities?.input.includes("audio")) {
		tags.push({ label: "Audio", style: "bg-green-500/15 text-green-400" })
	}
	if (model.status === "beta") {
		tags.push({ label: "Beta", style: "bg-warning/15 text-warning" })
	}
	if (model.status === "deprecated") {
		tags.push({ label: "Deprecated", style: "bg-danger/15 text-danger" })
	}
	return tags
}

/**
 * Models configuration tab in Settings.
 *
 * Only shows models from connected providers.
 * Models are disabled by default -- user explicitly enables the ones they want.
 * Shows capability badges and groups by provider with popularity ordering.
 */
export function ModelsConfig({ className }: { className?: string }) {
	const connected = useProviderStore((s) => s.connected)
	const enabledModels = useConfigStore((s) => s.config.enabledModels)

	const [search, setSearch] = useState("")
	const [providerFilter, setProviderFilter] = useState<Set<string>>(new Set())
	const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())

	const enabledSet = useMemo(() => new Set(enabledModels), [enabledModels])

	// Only show connected providers that have models
	const providersWithModels = useMemo(
		() => connected.filter((p) => p.models.length > 0),
		[connected],
	)

	// Filtered providers and models based on search + provider filter
	const filteredProviders = useMemo(() => {
		const q = search.toLowerCase().trim()
		return providersWithModels
			.filter((p) => providerFilter.size === 0 || providerFilter.has(p.id))
			.map((p) => ({
				...p,
				models: q
					? p.models.filter(
							(m) =>
								m.name.toLowerCase().includes(q) ||
								m.id.toLowerCase().includes(q) ||
								p.name.toLowerCase().includes(q),
						)
					: p.models,
			}))
			.filter((p) => p.models.length > 0)
	}, [providersWithModels, search, providerFilter])

	const toggleProviderFilter = useCallback((providerId: string) => {
		setProviderFilter((prev) => {
			const next = new Set(prev)
			if (next.has(providerId)) {
				next.delete(providerId)
			} else {
				next.add(providerId)
			}
			return next
		})
	}, [])

	const toggleExpanded = useCallback((providerId: string) => {
		setExpandedProviders((prev) => {
			const next = new Set(prev)
			if (next.has(providerId)) {
				next.delete(providerId)
			} else {
				next.add(providerId)
			}
			return next
		})
	}, [])

	const toggleModel = useCallback(
		(providerId: string, modelId: string) => {
			const key = modelKey(providerId, modelId)
			const next = enabledSet.has(key)
				? enabledModels.filter((k) => k !== key)
				: [...enabledModels, key]
			useConfigStore.getState().update({ enabledModels: next })
		},
		[enabledModels, enabledSet],
	)

	const enableAllForProvider = useCallback(
		(providerId: string, models: ProviderInfo["models"]) => {
			const existing = new Set(enabledModels)
			const next = [...enabledModels]
			for (const m of models) {
				const key = modelKey(providerId, m.id)
				if (!existing.has(key)) next.push(key)
			}
			useConfigStore.getState().update({ enabledModels: next })
		},
		[enabledModels],
	)

	const disableAllForProvider = useCallback(
		(providerId: string, models: ProviderInfo["models"]) => {
			const providerKeys = new Set(models.map((m) => modelKey(providerId, m.id)))
			const next = enabledModels.filter((k) => !providerKeys.has(k))
			useConfigStore.getState().update({ enabledModels: next })
		},
		[enabledModels],
	)

	// Count enabled models across connected providers
	const totalModels = providersWithModels.reduce((sum, p) => sum + p.models.length, 0)

	return (
		<div className={className}>
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold text-foreground">Models</h1>
					<p className="mt-1 text-xs text-muted">
						{enabledModels.length} of {totalModels} models enabled
					</p>
				</div>
			</div>

			{/* Empty state: no connected providers */}
			{providersWithModels.length === 0 && (
				<div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
					<p className="text-sm text-muted">
						Connect a provider in the Providers tab to see available models.
					</p>
				</div>
			)}

			{providersWithModels.length > 0 && (
				<>
					{/* Search */}
					<div className="mb-4">
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search models by name, ID, or provider..."
							className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
						/>
					</div>

					{/* Provider filter chips */}
					{providersWithModels.length > 1 && (
						<div className="mb-4 flex flex-wrap gap-1.5">
							{providersWithModels.map((p) => {
								const enabledCount = p.models.filter((m) =>
									enabledSet.has(modelKey(p.id, m.id)),
								).length
								const isActive = providerFilter.has(p.id)
								return (
									<button
										key={p.id}
										type="button"
										onClick={() => toggleProviderFilter(p.id)}
										className={cn(
											"flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
											isActive
												? "bg-accent/15 text-accent"
												: providerFilter.size === 0
													? "bg-surface-hover text-foreground"
													: "bg-surface text-muted hover:bg-surface-hover",
										)}
									>
										<ProviderIcon
											providerId={p.id}
											providerName={p.name}
											size="xs"
											className="shrink-0"
										/>
										{p.name}
										<span className="text-[10px] opacity-60">
											{enabledCount}/{p.models.length}
										</span>
									</button>
								)
							})}
						</div>
					)}

					{/* Provider sections */}
					{filteredProviders.length === 0 && (
						<div className="rounded-xl border border-dashed border-border px-5 py-12 text-center text-sm text-muted">
							No models match your search.
						</div>
					)}

					{filteredProviders.map((provider) => (
						<ProviderModelSection
							key={provider.id}
							provider={provider}
							enabledSet={enabledSet}
							expanded={expandedProviders.has(provider.id) || search.length > 0}
							onToggleExpand={() => toggleExpanded(provider.id)}
							onToggleModel={toggleModel}
							onEnableAll={() => enableAllForProvider(provider.id, provider.models)}
							onDisableAll={() => disableAllForProvider(provider.id, provider.models)}
						/>
					))}
				</>
			)}
		</div>
	)
}

function ProviderModelSection({
	provider,
	enabledSet,
	expanded,
	onToggleExpand,
	onToggleModel,
	onEnableAll,
	onDisableAll,
}: {
	provider: ProviderInfo
	enabledSet: Set<string>
	expanded: boolean
	onToggleExpand: () => void
	onToggleModel: (providerId: string, modelId: string) => void
	onEnableAll: () => void
	onDisableAll: () => void
}) {
	const models = provider.models
	const needsAccordion = models.length > INITIAL_VISIBLE_COUNT
	const visibleModels =
		needsAccordion && !expanded ? models.slice(0, INITIAL_VISIBLE_COUNT) : models
	const hiddenCount = models.length - INITIAL_VISIBLE_COUNT

	// Count enabled in this provider
	const enabledInProvider = models.filter((m) => enabledSet.has(modelKey(provider.id, m.id))).length
	const allEnabled = enabledInProvider === models.length

	return (
		<div className="el-card mb-4 overflow-hidden bg-surface/30">
			{/* Provider header */}
			<div className="flex items-center justify-between border-b border-[var(--separator)] px-5 py-3.5">
				<div className="flex items-center gap-2.5">
					<ProviderIcon providerId={provider.id} providerName={provider.name} size="md" />
					<span className="text-sm font-semibold text-foreground">{provider.name}</span>
					<span className="text-xs text-muted">
						{enabledInProvider}/{models.length}
					</span>
				</div>
				<div className="flex items-center gap-3">
					<ToggleSwitch checked={allEnabled} onChange={allEnabled ? onDisableAll : onEnableAll} />
					<button
						type="button"
						onClick={allEnabled ? onDisableAll : onEnableAll}
						className="text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						{allEnabled ? "Disable all" : "Enable all"}
					</button>
				</div>
			</div>

			{/* Model rows */}
			<div className="divide-y divide-[var(--separator)]">
				{visibleModels.map((model) => {
					const key = modelKey(provider.id, model.id)
					const enabled = enabledSet.has(key)
					return (
						<ModelRow
							key={model.id}
							model={model}
							enabled={enabled}
							onToggle={() => onToggleModel(provider.id, model.id)}
						/>
					)
				})}
			</div>

			{/* Show more accordion */}
			{needsAccordion && !expanded && hiddenCount > 0 && (
				<button
					type="button"
					onClick={onToggleExpand}
					className="flex w-full items-center justify-center gap-1.5 border-t border-[var(--separator)] px-5 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
				>
					<ChevronDown className="h-3 w-3" aria-hidden="true" />
					Show {hiddenCount} more
				</button>
			)}
			{needsAccordion && expanded && (
				<button
					type="button"
					onClick={onToggleExpand}
					className="flex w-full items-center justify-center gap-1.5 border-t border-[var(--separator)] px-5 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
				>
					<ChevronUp className="h-3 w-3" aria-hidden="true" />
					Show less
				</button>
			)}
		</div>
	)
}

// ─── Model Row with Tooltip ─────────────────────────────────────

function ModelRow({
	model,
	enabled,
	onToggle,
}: {
	model: ModelInfo
	enabled: boolean
	onToggle: () => void
}) {
	const rowRef = useRef<HTMLDivElement>(null)
	const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null)
	const [tooltipVisible, setTooltipVisible] = useState(false)
	const showTimer = useRef<ReturnType<typeof setTimeout>>(null)
	const unmountTimer = useRef<ReturnType<typeof setTimeout>>(null)

	const showTooltip = useCallback(() => {
		if (showTimer.current) clearTimeout(showTimer.current)
		if (unmountTimer.current) {
			clearTimeout(unmountTimer.current)
			unmountTimer.current = null
		}
		showTimer.current = setTimeout(() => {
			const rect = rowRef.current?.getBoundingClientRect()
			if (!rect) return
			setTooltipPos({ top: rect.top + rect.height / 2, left: rect.left - 8 })
			setTooltipVisible(true)
		}, 300)
	}, [])

	const hideTooltip = useCallback(() => {
		if (showTimer.current) clearTimeout(showTimer.current)
		setTooltipVisible(false)
		unmountTimer.current = setTimeout(() => setTooltipPos(null), 150)
	}, [])

	return (
		<div
			ref={rowRef}
			className="flex items-center justify-between px-5 py-3"
			onMouseEnter={showTooltip}
			onMouseLeave={hideTooltip}
		>
			<span className="min-w-0 truncate text-sm text-foreground">{model.name}</span>
			<ToggleSwitch checked={enabled} onChange={onToggle} />
			{tooltipPos &&
				createPortal(
					<ModelDetailTooltip model={model} style={tooltipPos} visible={tooltipVisible} />,
					document.body,
				)}
		</div>
	)
}

// ─── Shared Model Detail Tooltip ────────────────────────────────

function ModelDetailTooltip({
	model,
	style,
	visible,
}: {
	model: ModelInfo
	style: { top: number; left: number }
	visible: boolean
}) {
	const tags = capabilityTags(model)

	return (
		<div
			className="pointer-events-none rounded-lg border border-border bg-surface p-3 shadow-lg transition-opacity duration-150 ease-out"
			style={{
				position: "fixed",
				top: style.top,
				right: window.innerWidth - style.left,
				transform: "translateY(-50%)",
				width: 260,
				zIndex: 60,
				opacity: visible ? 1 : 0,
			}}
		>
			<div className="text-sm font-medium text-foreground">{model.name}</div>
			<div className="mt-1.5 space-y-1 text-xs text-muted">
				<div>
					{formatTokens(model.contextWindow)} context
					{model.maxOutput > 0 && <> &middot; {formatTokens(model.maxOutput)} max output</>}
				</div>
				{tags.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{tags.map((t) => (
							<span
								key={t.label}
								className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", t.style)}
							>
								{t.label}
							</span>
						))}
					</div>
				)}
				{(model.pricing.input > 0 || model.pricing.output > 0) && (
					<div>
						${model.pricing.input.toFixed(2)}/M in &middot; ${model.pricing.output.toFixed(2)}/M out
					</div>
				)}
				{model.pricing.input === 0 && model.pricing.output === 0 && (
					<div className="text-success">Free</div>
				)}
				{model.modalities && model.modalities.input.length > 1 && (
					<div>{model.modalities.input.join(", ")}</div>
				)}
			</div>
		</div>
	)
}

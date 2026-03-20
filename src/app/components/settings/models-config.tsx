import type { ProviderInfo } from "@core/schema/provider"
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline"
import { useCallback, useMemo, useState } from "react"
import { modelKey } from "../../lib/model-filter"
import { useConfigStore } from "../../stores/config-store"
import { useProviderStore } from "../../stores/provider-store"
import { cn } from "../ui/cn"

const INITIAL_VISIBLE_COUNT = 20

/**
 * Models configuration tab in Settings.
 *
 * Only shows models from connected providers.
 * Models are disabled by default — user explicitly enables the ones they want.
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
							(m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
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
				<div className="rounded-xl border border-border px-5 py-10 text-center text-sm text-muted">
					Connect a provider in the Providers tab to see available models.
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
							placeholder="Search models..."
							className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
						/>
					</div>

					{/* Provider filter chips */}
					{providersWithModels.length > 1 && (
						<div className="mb-4 flex flex-wrap gap-1.5">
							{providersWithModels.map((p) => (
								<button
									key={p.id}
									type="button"
									onClick={() => toggleProviderFilter(p.id)}
									className={cn(
										"flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
										providerFilter.has(p.id)
											? "bg-accent/15 text-accent"
											: providerFilter.size === 0
												? "bg-surface-hover text-foreground"
												: "bg-surface text-muted hover:bg-surface-hover",
									)}
								>
									{p.name}
									<span className="text-[10px] opacity-60">{p.models.length}</span>
								</button>
							))}
						</div>
					)}

					{/* Provider sections */}
					{filteredProviders.length === 0 && (
						<div className="rounded-xl border border-border px-5 py-10 text-center text-sm text-muted">
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
	const noneEnabled = enabledInProvider === 0

	return (
		<div className="mb-4 rounded-xl border border-border">
			{/* Provider header */}
			<div className="flex items-center justify-between border-b border-border px-5 py-3">
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold text-foreground">{provider.name}</span>
					<span className="text-xs text-muted">
						{enabledInProvider}/{models.length} enabled
					</span>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={allEnabled ? onDisableAll : onEnableAll}
						className="text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						{allEnabled ? "Disable all" : noneEnabled ? "Enable all" : "Enable all"}
					</button>
				</div>
			</div>

			{/* Model rows */}
			<div className="divide-y divide-border">
				{visibleModels.map((model) => {
					const key = modelKey(provider.id, model.id)
					const enabled = enabledSet.has(key)
					return (
						<div key={model.id} className="flex items-center justify-between px-5 py-2.5">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="truncate text-sm text-foreground">{model.name}</span>
									{model.status === "beta" && (
										<span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
											Beta
										</span>
									)}
								</div>
								<div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted">
									<span>{formatTokens(model.contextWindow)} ctx</span>
									<span>{formatTokens(model.maxOutput)} max</span>
									{model.pricing.input > 0 && <span>${model.pricing.input.toFixed(2)}/M in</span>}
								</div>
							</div>
							<ToggleSwitch
								checked={enabled}
								onChange={() => onToggleModel(provider.id, model.id)}
							/>
						</div>
					)
				})}
			</div>

			{/* Show more accordion */}
			{needsAccordion && !expanded && hiddenCount > 0 && (
				<button
					type="button"
					onClick={onToggleExpand}
					className="flex w-full items-center justify-center gap-1.5 border-t border-border px-5 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
				>
					<ChevronDownIcon className="h-3 w-3" aria-hidden="true" />
					Show {hiddenCount} more
				</button>
			)}
			{needsAccordion && expanded && (
				<button
					type="button"
					onClick={onToggleExpand}
					className="flex w-full items-center justify-center gap-1.5 border-t border-border px-5 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
				>
					<ChevronUpIcon className="h-3 w-3" aria-hidden="true" />
					Show less
				</button>
			)}
		</div>
	)
}

function ToggleSwitch({
	checked,
	onChange,
}: {
	checked: boolean
	onChange: () => void
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={onChange}
			className={cn(
				"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
				checked ? "bg-accent" : "bg-default",
			)}
		>
			<span
				className={cn(
					"inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
					checked ? "translate-x-[18px]" : "translate-x-[2px]",
				)}
			/>
		</button>
	)
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
	return String(n)
}

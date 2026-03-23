import type { ProviderInfo } from "@core/schema/provider"
import { useMemo, useState } from "react"
import { POPULAR_PROVIDER_IDS } from "./provider-config"
import { CloseIcon, ProviderAvatar } from "./shared"

// ─── Types ──────────────────────────────────────────────────

interface SelectProviderDialogProps {
	providers: ProviderInfo[]
	connectedIds?: Set<string>
	open: boolean
	onClose: () => void
	onSelectProvider: (provider: ProviderInfo) => void
	onSelectCustom: () => void
}

// ─── Component ──────────────────────────────────────────────

export function SelectProviderDialog({
	providers,
	connectedIds,
	open,
	onClose,
	onSelectProvider,
	onSelectCustom,
}: SelectProviderDialogProps) {
	const [search, setSearch] = useState("")

	const popularSet = useMemo(() => new Set(POPULAR_PROVIDER_IDS), [])

	const grouped = useMemo(() => {
		const query = search.toLowerCase().trim()
		const filtered = query
			? providers.filter((p) => p.id.includes(query) || p.name.toLowerCase().includes(query))
			: providers

		const popular: ProviderInfo[] = []
		const other: ProviderInfo[] = []

		for (const p of filtered) {
			if (popularSet.has(p.id)) popular.push(p)
			else other.push(p)
		}

		// Sort popular by defined order
		popular.sort((a, b) => POPULAR_PROVIDER_IDS.indexOf(a.id) - POPULAR_PROVIDER_IDS.indexOf(b.id))
		// Sort other alphabetically
		other.sort((a, b) => a.name.localeCompare(b.name))

		return { popular, other }
	}, [providers, search, popularSet])

	// Show custom provider entry when search matches
	const showCustom = !search || "custom provider".includes(search.toLowerCase().trim())

	if (!open) return null

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
			<div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

			<div
				className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
				style={{ maxHeight: "70vh" }}
			>
				{/* Header */}
				<div className="flex items-center justify-between border-b border-border px-6 py-4">
					<h2 className="text-base font-semibold text-foreground">Connect a provider</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
						aria-label="Close"
					>
						<CloseIcon />
					</button>
				</div>

				{/* Search */}
				<div className="border-b border-border px-5 py-3">
					<input
						type="text"
						placeholder="Search providers..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
						// biome-ignore lint/a11y/noAutofocus: dialog search should auto-focus
						autoFocus
					/>
				</div>

				{/* Provider list */}
				<div className="flex-1 overflow-y-auto px-2 py-2">
					{/* Popular */}
					{grouped.popular.length > 0 && (
						<div className="mb-2">
							<span className="block px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								Popular
							</span>
							{grouped.popular.map((p) => (
								<ProviderListItem
									key={p.id}
									provider={p}
									connected={connectedIds?.has(p.id)}
									onSelect={onSelectProvider}
								/>
							))}
						</div>
					)}

					{/* Custom provider entry */}
					{showCustom && (
						<button
							type="button"
							onClick={onSelectCustom}
							className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
						>
							<ProviderAvatar letter="+" />
							<span className="text-sm font-medium text-foreground">Custom provider</span>
							<span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
								Custom
							</span>
						</button>
					)}

					{/* Other */}
					{grouped.other.length > 0 && (
						<div className="mt-2">
							<span className="block px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								Other
							</span>
							{grouped.other.map((p) => (
								<ProviderListItem
									key={p.id}
									provider={p}
									connected={connectedIds?.has(p.id)}
									onSelect={onSelectProvider}
								/>
							))}
						</div>
					)}

					{grouped.popular.length === 0 && grouped.other.length === 0 && !showCustom && (
						<p className="py-8 text-center text-sm text-muted">No providers found.</p>
					)}
				</div>
			</div>
		</div>
	)
}

// ─── List Item ──────────────────────────────────────────────

function ProviderListItem({
	provider,
	connected,
	onSelect,
}: {
	provider: ProviderInfo
	connected?: boolean
	onSelect: (p: ProviderInfo) => void
}) {
	return (
		<button
			type="button"
			onClick={() => onSelect(provider)}
			className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
		>
			<ProviderAvatar letter={provider.name.charAt(0)} providerId={provider.id} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-foreground">{provider.name}</span>
					{connected && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
				</div>
				{provider.description && (
					<p className="truncate text-xs text-muted">{provider.description}</p>
				)}
			</div>
		</button>
	)
}

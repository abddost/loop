import type { ProviderInfo } from "@core/schema/provider"
import { type FormEvent, useCallback, useState } from "react"

export interface ProviderConfigProps {
	connected: ProviderInfo[]
	popular: ProviderInfo[]
	other: ProviderInfo[]
	onSave: (providerId: string, apiKey: string) => void
	onRemoveKey: (providerId: string) => void
	className?: string
}

/**
 * Provider configuration with categorized card-based sections.
 */
export function ProviderConfig({
	connected,
	popular,
	other,
	onSave,
	onRemoveKey,
	className,
}: ProviderConfigProps) {
	const [keys, setKeys] = useState<Record<string, string>>({})

	const handleSubmit = useCallback(
		(providerId: string) => (e: FormEvent) => {
			e.preventDefault()
			const key = keys[providerId]?.trim()
			if (key) {
				onSave(providerId, key)
				setKeys((prev) => ({ ...prev, [providerId]: "" }))
			}
		},
		[keys, onSave],
	)

	return (
		<div className={className}>
			{connected.length > 0 && (
				<ProviderSection
					title="Connected"
					providers={connected}
					keys={keys}
					setKeys={setKeys}
					onSubmit={handleSubmit}
					onRemoveKey={onRemoveKey}
					showRemove
				/>
			)}

			{popular.length > 0 && (
				<ProviderSection
					title="Popular"
					providers={popular}
					keys={keys}
					setKeys={setKeys}
					onSubmit={handleSubmit}
					onRemoveKey={onRemoveKey}
				/>
			)}

			{other.length > 0 && (
				<OtherProvidersSection
					providers={other}
					keys={keys}
					setKeys={setKeys}
					onSubmit={handleSubmit}
				/>
			)}
		</div>
	)
}

function ProviderSection({
	title,
	providers,
	keys,
	setKeys,
	onSubmit,
	onRemoveKey,
	showRemove,
}: {
	title: string
	providers: ProviderInfo[]
	keys: Record<string, string>
	setKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>
	onSubmit: (id: string) => (e: FormEvent) => void
	onRemoveKey?: (id: string) => void
	showRemove?: boolean
}) {
	return (
		<div className="mb-8">
			<h2 className="mb-4 text-base font-semibold text-foreground">{title}</h2>
			<div className="divide-y divide-border rounded-xl border border-border">
				{providers.map((provider) => (
					<ProviderRow
						key={provider.id}
						provider={provider}
						apiKeyValue={keys[provider.id] ?? ""}
						onKeyChange={(val) => setKeys((prev) => ({ ...prev, [provider.id]: val }))}
						onSubmit={onSubmit(provider.id)}
						onRemove={showRemove ? () => onRemoveKey?.(provider.id) : undefined}
					/>
				))}
			</div>
		</div>
	)
}

function OtherProvidersSection({
	providers,
	keys,
	setKeys,
	onSubmit,
}: {
	providers: ProviderInfo[]
	keys: Record<string, string>
	setKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>
	onSubmit: (id: string) => (e: FormEvent) => void
}) {
	const [expanded, setExpanded] = useState(false)

	return (
		<div className="mb-8">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground"
			>
				<span className="text-xs text-muted">{expanded ? "\u25BC" : "\u25B6"}</span>
				Other Providers ({providers.length})
			</button>
			{expanded && (
				<div className="divide-y divide-border rounded-xl border border-border">
					{providers.map((provider) => (
						<ProviderRow
							key={provider.id}
							provider={provider}
							apiKeyValue={keys[provider.id] ?? ""}
							onKeyChange={(val) => setKeys((prev) => ({ ...prev, [provider.id]: val }))}
							onSubmit={onSubmit(provider.id)}
						/>
					))}
				</div>
			)}
		</div>
	)
}

function ProviderRow({
	provider,
	apiKeyValue,
	onKeyChange,
	onSubmit,
	onRemove,
}: {
	provider: ProviderInfo
	apiKeyValue: string
	onKeyChange: (value: string) => void
	onSubmit: (e: FormEvent) => void
	onRemove?: () => void
}) {
	const envHint = provider.envKeys[0] ?? "API_KEY"

	return (
		<form onSubmit={onSubmit} className="px-5 py-5">
			{/* Header: name + badge + model count */}
			<div className="mb-3 flex items-center gap-2">
				<span className="text-sm font-semibold text-foreground">{provider.name}</span>
				{provider.configured && (
					<span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-medium text-success">
						Connected
					</span>
				)}
				<span className="ml-auto text-xs text-muted">{provider.models.length} models</span>
			</div>

			{/* Input + actions row */}
			<div className="flex items-center gap-2">
				<input
					id={`provider-key-${provider.id}`}
					type="password"
					placeholder={`${envHint}...`}
					value={apiKeyValue}
					onChange={(e) => onKeyChange(e.target.value)}
					className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
				/>
				<button
					type="submit"
					className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
				>
					Save
				</button>
				{onRemove && (
					<button
						type="button"
						onClick={onRemove}
						className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
					>
						Remove
					</button>
				)}
			</div>
		</form>
	)
}

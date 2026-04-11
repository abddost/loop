import type { ProviderInfo } from "@core/schema/provider"
import { useCallback, useMemo, useState } from "react"
import { apiClient } from "../../lib/api-client"
import { cn } from "../ui/cn"
import { ProviderIcon } from "../ui/provider-icon"
import { ConnectProviderDialog } from "./connect-provider-dialog"
import { CustomProviderDialog } from "./custom-provider-dialog"
import { SelectProviderDialog } from "./select-provider-dialog"
import { ProviderAvatar, SourceBadge } from "./shared"

export interface ProviderConfigProps {
	connected: ProviderInfo[]
	popular: ProviderInfo[]
	other: ProviderInfo[]
	onRefresh: () => void
	className?: string
}

/**
 * Popular provider IDs — order determines display order.
 * Exported for reuse by SelectProviderDialog.
 */
export const POPULAR_PROVIDER_IDS = [
	"anthropic",
	"openai",
	"google",
	"openrouter",
	"xai",
	"mistral",
	"groq",
	"deepseek",
	"github-copilot",
]

// ─── Provider descriptions ──────────────────────────────────────

const PROVIDER_NOTES: Record<string, string> = {
	anthropic: "Claude models for advanced reasoning and coding",
	openai: "GPT models for fast, capable general AI tasks",
	google: "Gemini models for fast, structured responses",
	openrouter: "Unified access to multiple AI providers",
	"github-copilot": "AI models for coding assistance via GitHub Copilot",
	xai: "Grok models for reasoning and analysis",
	mistral: "European AI models for efficient inference",
	groq: "High-speed inference with optimized hardware",
	deepseek: "Advanced reasoning and coding models",
}

// ─── Component ──────────────────────────────────────────────────

export function ProviderConfig({
	connected,
	popular,
	other,
	onRefresh,
	className,
}: ProviderConfigProps) {
	const [connectDialog, setConnectDialog] = useState<ProviderInfo | null>(null)
	const [selectDialogOpen, setSelectDialogOpen] = useState(false)
	const [customDialogOpen, setCustomDialogOpen] = useState(false)

	const allProviders = useMemo(
		() => [...connected, ...popular, ...other],
		[connected, popular, other],
	)
	const existingProviderIds = useMemo(() => new Set(allProviders.map((p) => p.id)), [allProviders])

	const popularUnconnected = useMemo(() => {
		const connectedIds = new Set(connected.map((p) => p.id))
		const ids = POPULAR_PROVIDER_IDS.filter((id) => !connectedIds.has(id))
		return ids
			.map((id) => allProviders.find((p) => p.id === id))
			.filter((p): p is ProviderInfo => !!p)
	}, [connected, allProviders])

	const canDisconnect = useCallback((provider: ProviderInfo) => provider.source !== "env", [])

	const disconnect = useCallback(
		async (provider: ProviderInfo) => {
			try {
				await apiClient.del(`/providers/${provider.id}/key`)
				onRefresh()
			} catch (err) {
				console.error("[provider:disconnect]", err)
			}
		},
		[onRefresh],
	)

	const openConnect = useCallback((provider: ProviderInfo) => {
		setConnectDialog(provider)
	}, [])

	return (
		<div className={className}>
			{/* Connected Section */}
			<div className="mb-8">
				<h3 className="mb-3 text-sm font-medium text-foreground">Connected</h3>
				<div className="overflow-hidden rounded-xl border border-border bg-surface/30">
					{connected.length === 0 ? (
						<p className="px-5 py-5 text-center text-sm text-muted">
							No providers connected yet. Connect one below to get started.
						</p>
					) : (
						connected.map((provider, i) => (
							<ConnectedRow
								key={provider.id}
								provider={provider}
								canDisconnect={canDisconnect(provider)}
								onDisconnect={() => disconnect(provider)}
								isLast={i === connected.length - 1}
							/>
						))
					)}
				</div>
			</div>

			{/* Popular / Connect Section */}
			<div className="mb-8">
				<h3 className="mb-3 text-sm font-medium text-foreground">Popular</h3>
				<div className="overflow-hidden rounded-xl border border-border bg-surface/30">
					{popularUnconnected.map((provider, i) => (
						<PopularRow
							key={provider.id}
							provider={provider}
							onConnect={() => openConnect(provider)}
							isLast={i === popularUnconnected.length - 1 && !true}
						/>
					))}

					{/* Custom provider entry */}
					<div
						className={cn(
							"flex items-center justify-between gap-4 px-5 py-4",
							popularUnconnected.length > 0 && "border-t border-border",
						)}
					>
						<div className="flex min-w-0 items-center gap-3">
							<ProviderAvatar letter="+" />
							<div className="flex min-w-0 flex-col">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-foreground">Custom provider</span>
									<SourceBadge source="custom" />
								</div>
								<span className="mt-0.5 text-xs text-muted">
									Add an OpenAI-compatible provider by base URL.
								</span>
							</div>
						</div>
						<button
							type="button"
							onClick={() => setCustomDialogOpen(true)}
							className="el-surface-hover shrink-0 rounded-lg border border-border px-4 py-1.5 text-sm font-medium text-foreground transition-colors"
						>
							+ Connect
						</button>
					</div>
				</div>

				{/* View all providers link */}
				<button
					type="button"
					onClick={() => setSelectDialogOpen(true)}
					className="mt-4 text-sm font-medium text-accent transition-colors hover:text-accent/80"
				>
					View all providers
				</button>
			</div>

			{/* Dialogs */}
			{connectDialog && (
				<ConnectProviderDialog
					provider={connectDialog}
					open={!!connectDialog}
					onClose={() => setConnectDialog(null)}
					onBack={() => setConnectDialog(null)}
					onConnected={() => {
						setConnectDialog(null)
						onRefresh()
					}}
				/>
			)}

			<SelectProviderDialog
				providers={allProviders}
				connectedIds={new Set(connected.map((p) => p.id))}
				open={selectDialogOpen}
				onClose={() => setSelectDialogOpen(false)}
				onSelectProvider={(provider) => {
					setSelectDialogOpen(false)
					openConnect(provider)
				}}
				onSelectCustom={() => {
					setSelectDialogOpen(false)
					setCustomDialogOpen(true)
				}}
			/>

			<CustomProviderDialog
				open={customDialogOpen}
				onClose={() => setCustomDialogOpen(false)}
				onSaved={() => {
					setCustomDialogOpen(false)
					onRefresh()
				}}
				existingProviderIds={existingProviderIds}
			/>
		</div>
	)
}

// ─── Connected Row ──────────────────────────────────────────────

function ConnectedRow({
	provider,
	canDisconnect,
	onDisconnect,
	isLast,
}: {
	provider: ProviderInfo
	canDisconnect: boolean
	onDisconnect: () => void
	isLast: boolean
}) {
	const [confirming, setConfirming] = useState(false)

	return (
		<div
			className={cn(
				"group flex items-center justify-between gap-4 px-5 py-4",
				!isLast && "border-b border-border",
			)}
		>
			<div className="flex min-w-0 items-center gap-3">
				<ProviderIcon providerId={provider.id} providerName={provider.name} size="md" />
				<span className="text-sm font-medium text-foreground">{provider.name}</span>
				<SourceBadge source={provider.source} />
			</div>

			{canDisconnect ? (
				<div className="flex items-center gap-2">
					{confirming ? (
						<>
							<button
								type="button"
								onClick={() => {
									onDisconnect()
									setConfirming(false)
								}}
								className="text-xs font-medium text-danger transition-colors hover:text-danger/80"
							>
								Disconnect
							</button>
							<button
								type="button"
								onClick={() => setConfirming(false)}
								className="text-xs text-muted-foreground transition-colors hover:text-foreground"
							>
								Cancel
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={() => setConfirming(true)}
							className="text-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground"
						>
							Disconnect
						</button>
					)}
				</div>
			) : (
				<span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
					Set via environment
				</span>
			)}
		</div>
	)
}

// ─── Popular Row ────────────────────────────────────────────────

function PopularRow({
	provider,
	onConnect,
	isLast,
}: {
	provider: ProviderInfo
	onConnect: () => void
	isLast: boolean
}) {
	const note = PROVIDER_NOTES[provider.id] ?? provider.description

	return (
		<div
			className={cn(
				"flex items-center justify-between gap-4 px-5 py-4",
				!isLast && "border-b border-border",
			)}
		>
			<div className="flex min-w-0 items-center gap-3">
				<ProviderIcon providerId={provider.id} providerName={provider.name} size="md" />
				<div className="flex min-w-0 flex-col">
					<span className="text-sm font-medium text-foreground">{provider.name}</span>
					{note && <span className="mt-0.5 text-xs text-muted">{note}</span>}
				</div>
			</div>
			<button
				type="button"
				onClick={onConnect}
				className="el-surface-hover shrink-0 rounded-lg border border-border px-4 py-1.5 text-sm font-medium text-foreground transition-colors"
			>
				+ Connect
			</button>
		</div>
	)
}

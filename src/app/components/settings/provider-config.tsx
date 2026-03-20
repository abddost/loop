import type { ProviderInfo } from "@core/schema/provider"
import { ArrowUpRightIcon, CheckIcon } from "@heroicons/react/24/outline"
import { type FormEvent, useCallback, useState } from "react"
import { apiClient } from "../../lib/api-client"
import { cn } from "../ui/cn"

export interface ProviderConfigProps {
	connected: ProviderInfo[]
	popular: ProviderInfo[]
	other: ProviderInfo[]
	onSave: (providerId: string, apiKey: string, baseUrl?: string) => void
	onRemoveKey: (providerId: string) => void
	onOAuthComplete?: () => void
	className?: string
}

/**
 * Provider configuration with categorized card-based sections.
 *
 * Each provider shows name + description + "+ Connect" button.
 * Clicking Connect expands to show available auth methods.
 * Connected providers show a "Connected" badge and management controls.
 */
export function ProviderConfig({
	connected,
	popular,
	other,
	onSave,
	onRemoveKey,
	onOAuthComplete,
	className,
}: ProviderConfigProps) {
	return (
		<div className={className}>
			{connected.length > 0 && (
				<ProviderSection
					title="Connected"
					providers={connected}
					onSave={onSave}
					onRemoveKey={onRemoveKey}
					onOAuthComplete={onOAuthComplete}
				/>
			)}

			{popular.length > 0 && (
				<ProviderSection
					title="Popular"
					providers={popular}
					onSave={onSave}
					onRemoveKey={onRemoveKey}
					onOAuthComplete={onOAuthComplete}
				/>
			)}

			{other.length > 0 && (
				<OtherProvidersSection
					providers={other}
					onSave={onSave}
					onOAuthComplete={onOAuthComplete}
				/>
			)}
		</div>
	)
}

// ─── Sections ────────────────────────────────────────────────

function ProviderSection({
	title,
	providers,
	onSave,
	onRemoveKey,
	onOAuthComplete,
}: {
	title: string
	providers: ProviderInfo[]
	onSave: (id: string, key: string, baseUrl?: string) => void
	onRemoveKey?: (id: string) => void
	onOAuthComplete?: () => void
}) {
	return (
		<div className="mb-8">
			<h2 className="mb-4 text-base font-semibold text-foreground">{title}</h2>
			<div className="divide-y divide-border rounded-xl border border-border">
				{providers.map((provider) => (
					<ProviderRow
						key={provider.id}
						provider={provider}
						onSave={onSave}
						onRemoveKey={onRemoveKey}
						onOAuthComplete={onOAuthComplete}
					/>
				))}
			</div>
		</div>
	)
}

function OtherProvidersSection({
	providers,
	onSave,
	onOAuthComplete,
}: {
	providers: ProviderInfo[]
	onSave: (id: string, key: string, baseUrl?: string) => void
	onOAuthComplete?: () => void
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
							onSave={onSave}
							onOAuthComplete={onOAuthComplete}
						/>
					))}
				</div>
			)}
		</div>
	)
}

// ─── Provider Row ────────────────────────────────────────────

function ProviderRow({
	provider,
	onSave,
	onRemoveKey,
	onOAuthComplete,
}: {
	provider: ProviderInfo
	onSave: (id: string, key: string, baseUrl?: string) => void
	onRemoveKey?: (id: string) => void
	onOAuthComplete?: () => void
}) {
	const [expanded, setExpanded] = useState(false)

	return (
		<div className="px-5 py-4">
			{/* Header row: name + description left, action right */}
			<div className="flex items-center gap-4">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="text-sm font-semibold text-foreground">{provider.name}</span>
						{provider.configured && (
							<span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
								Connected
							</span>
						)}
						{provider.models.length > 0 && (
							<span className="text-xs text-muted">{provider.models.length} models</span>
						)}
					</div>
					{provider.description && (
						<p className="mt-0.5 text-xs text-muted">{provider.description}</p>
					)}
				</div>

				{/* Connect / Manage button */}
				{provider.configured ? (
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="shrink-0 rounded-lg border border-border px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
					>
						{expanded ? "Close" : "Manage"}
					</button>
				) : (
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="shrink-0 rounded-lg border border-border px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
					>
						+ Connect
					</button>
				)}
			</div>

			{/* Expanded auth methods */}
			{expanded && (
				<AuthMethodPanel
					provider={provider}
					onSave={onSave}
					onRemoveKey={onRemoveKey}
					onOAuthComplete={onOAuthComplete}
				/>
			)}
		</div>
	)
}

// ─── Auth Method Panel ───────────────────────────────────────

type AuthTab = "api-key" | "oauth" | "custom-endpoint"

const TAB_LABELS: Record<AuthTab, string> = {
	"api-key": "API Key",
	oauth: "OAuth",
	"custom-endpoint": "Custom Endpoint",
}

function AuthMethodPanel({
	provider,
	onSave,
	onRemoveKey,
	onOAuthComplete,
}: {
	provider: ProviderInfo
	onSave: (id: string, key: string, baseUrl?: string) => void
	onRemoveKey?: (id: string) => void
	onOAuthComplete?: () => void
}) {
	const methods = provider.authMethods as AuthTab[]
	const hasMultiple = methods.length > 1
	const [activeTab, setActiveTab] = useState<AuthTab>(methods[0])

	return (
		<div className="mt-4 rounded-lg border border-border bg-background">
			{/* Auth method tabs (only if multiple methods) */}
			{hasMultiple && (
				<div className="flex border-b border-border">
					{methods.map((method) => (
						<TabButton
							key={method}
							active={activeTab === method}
							onClick={() => setActiveTab(method)}
						>
							{TAB_LABELS[method]}
						</TabButton>
					))}
				</div>
			)}

			{/* Tab content */}
			<div className="p-4">
				{activeTab === "api-key" && (
					<ApiKeyForm provider={provider} onSave={onSave} onRemoveKey={onRemoveKey} />
				)}
				{activeTab === "oauth" && <OAuthConnect provider={provider} onComplete={onOAuthComplete} />}
				{activeTab === "custom-endpoint" && (
					<CustomEndpointForm provider={provider} onSave={onSave} onRemoveKey={onRemoveKey} />
				)}
			</div>
		</div>
	)
}

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean
	onClick: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"px-4 py-2.5 text-sm font-medium transition-colors",
				active
					? "border-b-2 border-accent text-foreground"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			{children}
		</button>
	)
}

// ─── API Key Form ────────────────────────────────────────────

function ApiKeyForm({
	provider,
	onSave,
	onRemoveKey,
}: {
	provider: ProviderInfo
	onSave: (id: string, key: string, baseUrl?: string) => void
	onRemoveKey?: (id: string) => void
}) {
	const [key, setKey] = useState("")
	const envHint = provider.envKeys[0] ?? "API_KEY"

	const handleSubmit = useCallback(
		(e: FormEvent) => {
			e.preventDefault()
			const trimmed = key.trim()
			if (trimmed) {
				onSave(provider.id, trimmed)
				setKey("")
			}
		},
		[key, provider.id, onSave],
	)

	return (
		<form onSubmit={handleSubmit}>
			<p className="mb-3 text-xs text-muted">
				Enter your API key. You can also set the{" "}
				<code className="rounded bg-code-inline px-1 py-0.5 font-mono">{envHint}</code> environment
				variable.
			</p>
			<div className="flex items-center gap-2">
				<input
					type="password"
					placeholder={`${envHint}...`}
					value={key}
					onChange={(e) => setKey(e.target.value)}
					className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
				/>
				<button
					type="submit"
					disabled={!key.trim()}
					className={cn(
						"shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
						key.trim()
							? "bg-accent text-accent-foreground hover:bg-accent/90"
							: "cursor-not-allowed bg-accent/40 text-accent-foreground/60",
					)}
				>
					Save
				</button>
				{onRemoveKey && provider.configured && (
					<button
						type="button"
						onClick={() => onRemoveKey(provider.id)}
						className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-danger"
					>
						Disconnect
					</button>
				)}
			</div>
		</form>
	)
}

// ─── Custom Endpoint Form ────────────────────────────────────

function CustomEndpointForm({
	provider,
	onSave,
	onRemoveKey,
}: {
	provider: ProviderInfo
	onSave: (id: string, key: string, baseUrl?: string) => void
	onRemoveKey?: (id: string) => void
}) {
	const [baseUrl, setBaseUrl] = useState("")
	const [key, setKey] = useState("")

	const handleSubmit = useCallback(
		(e: FormEvent) => {
			e.preventDefault()
			const trimmedKey = key.trim()
			const trimmedUrl = baseUrl.trim()
			if (trimmedKey && trimmedUrl) {
				onSave(provider.id, trimmedKey, trimmedUrl)
				setKey("")
				setBaseUrl("")
			}
		},
		[key, baseUrl, provider.id, onSave],
	)

	const isValid = key.trim() && baseUrl.trim()

	return (
		<form onSubmit={handleSubmit}>
			<p className="mb-3 text-xs text-muted">
				Connect to a custom endpoint (Azure OpenAI, proxy, or self-hosted). Provide the base URL and
				API key.
			</p>
			<div className="mb-3">
				<label className="mb-1 block text-xs font-medium text-muted-foreground">
					Base URL
					<input
						type="text"
						placeholder="https://your-endpoint.openai.azure.com/..."
						value={baseUrl}
						onChange={(e) => setBaseUrl(e.target.value)}
						className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-normal text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
					/>
				</label>
			</div>
			<div className="mb-3">
				<label className="mb-1 block text-xs font-medium text-muted-foreground">
					API Key
					<input
						type="password"
						placeholder="API key..."
						value={key}
						onChange={(e) => setKey(e.target.value)}
						className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-normal text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
					/>
				</label>
			</div>
			<div className="flex items-center gap-2">
				<button
					type="submit"
					disabled={!isValid}
					className={cn(
						"shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
						isValid
							? "bg-accent text-accent-foreground hover:bg-accent/90"
							: "cursor-not-allowed bg-accent/40 text-accent-foreground/60",
					)}
				>
					Save
				</button>
				{onRemoveKey && provider.configured && (
					<button
						type="button"
						onClick={() => onRemoveKey(provider.id)}
						className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-danger"
					>
						Disconnect
					</button>
				)}
			</div>
		</form>
	)
}

// ─── OAuth Connect Flow ──────────────────────────────────────

type OAuthStatus = "idle" | "authorizing" | "polling" | "success" | "error"

function OAuthConnect({
	provider,
	onComplete,
}: {
	provider: ProviderInfo
	onComplete?: () => void
}) {
	const [status, setStatus] = useState<OAuthStatus>(provider.configured ? "success" : "idle")
	const [authInfo, setAuthInfo] = useState<{
		url?: string
		userCode?: string
		instructions?: string
	} | null>(null)
	const [error, setError] = useState<string | null>(null)

	const startOAuth = useCallback(async () => {
		setStatus("authorizing")
		setError(null)

		try {
			const result = await apiClient.post<{
				url: string
				userCode: string
				method: string
				instructions: string
			}>(`/providers/${provider.id}/oauth/authorize`, {})

			setAuthInfo(result)
			setStatus("polling")

			// Poll for completion in background
			try {
				await apiClient.post(`/providers/${provider.id}/oauth/callback`, {})
				setStatus("success")
				setAuthInfo(null)
				onComplete?.()
			} catch (err) {
				const message = err instanceof Error ? err.message : "Authorization failed"
				setError(message)
				setStatus("error")
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to start authorization"
			setError(message)
			setStatus("error")
		}
	}, [provider.id, onComplete])

	if (status === "success" && provider.configured) {
		return (
			<div className="flex items-center gap-2 text-sm text-success">
				<CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
				Connected via OAuth
			</div>
		)
	}

	if (status === "polling" && authInfo) {
		return (
			<div>
				<p className="mb-2 text-sm text-foreground">
					{authInfo.instructions || "Complete authorization in your browser:"}
				</p>
				{authInfo.userCode && (
					<div className="mb-3 flex items-center gap-2">
						<code className="rounded bg-code-inline px-2 py-1 font-mono text-sm font-bold text-foreground">
							{authInfo.userCode}
						</code>
						<button
							type="button"
							onClick={() => authInfo.userCode && navigator.clipboard.writeText(authInfo.userCode)}
							className="text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							Copy
						</button>
					</div>
				)}
				{authInfo.url && (
					<a
						href={authInfo.url}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1 text-sm text-accent underline underline-offset-2 hover:text-accent/80"
					>
						Open authorization page
						<ArrowUpRightIcon className="h-3 w-3" aria-hidden="true" />
					</a>
				)}
				<p className="mt-3 text-xs text-muted">Waiting for authorization...</p>
			</div>
		)
	}

	return (
		<div>
			<p className="mb-3 text-xs text-muted">Sign in to connect your {provider.name} account.</p>
			<button
				type="button"
				onClick={startOAuth}
				disabled={status === "authorizing"}
				className={cn(
					"rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors",
					status === "authorizing"
						? "cursor-not-allowed opacity-60"
						: "text-foreground hover:bg-surface-hover",
				)}
			>
				{status === "authorizing" ? "Connecting..." : `Sign in with ${provider.name}`}
			</button>
			{error && <p className="mt-2 text-xs text-danger">{error}</p>}
		</div>
	)
}

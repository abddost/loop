import { useCallback, useEffect, useState } from "react"
import { apiClient } from "../../lib/api-client"
import { useProviderStore } from "../../stores/provider-store"
import { cn } from "../ui/cn"
import { CheckIcon, ErrorIcon, Spinner, ToggleSwitch, formatError } from "./shared"

/**
 * Subset of `OpenCodeDetection` (server) consumed by the UI. Mirrors the
 * shape returned by `GET /providers/opencode/status`.
 */
interface OpenCodeDetection {
	installed: boolean
	connected: boolean
	binaryPath?: string
	version?: string
	versionWarning?: string
	serverUrl?: string
	mode: "local" | "remote"
	connectedUpstreamCount?: number
	upstreamProviderIds?: string[]
	error?: string
	/** Master enable flag — surfaced so the status pill reads "Disabled" not "Not installed". */
	enabled: boolean
}

interface OpenCodeSettings {
	enabled: boolean
	binaryPath: string
	serverUrl: string
	serverPassword: string
}

interface AppConfigResponse {
	opencode: OpenCodeSettings
}

/**
 * Settings card for the OpenCode runtime.
 *
 * Two connection modes:
 *   - **Local** (default): we spawn `opencode serve …` on demand using the
 *     binary at `binaryPath` (`opencode` on PATH unless overridden).
 *   - **Remote**: we connect to an externally-managed server at `serverUrl`,
 *     authenticating with `serverPassword` (HTTP Basic).
 *
 * Saving the form persists settings to `~/.loop/config.json` and triggers a
 * rescan, which refreshes the provider list and the model picker.
 */
export function OpenCodeConfig({ className }: { className?: string }) {
	const [detection, setDetection] = useState<OpenCodeDetection | null>(null)
	const [settings, setSettings] = useState<OpenCodeSettings | null>(null)
	const [loading, setLoading] = useState(true)
	const [rescanning, setRescanning] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [editing, setEditing] = useState(false)

	const loadAll = useCallback(async (signal?: AbortSignal) => {
		try {
			const [det, cfg] = await Promise.all([
				apiClient.get<OpenCodeDetection>("/providers/opencode/status", { signal }),
				apiClient.get<AppConfigResponse>("/config", { signal }),
			])
			if (signal?.aborted) return
			setDetection(det)
			setSettings(cfg.opencode)
			setError(null)
		} catch (err) {
			if (signal?.aborted) return
			setError(formatError(err, "Failed to load OpenCode settings"))
		} finally {
			if (!signal?.aborted) setLoading(false)
		}
	}, [])

	useEffect(() => {
		const controller = new AbortController()
		loadAll(controller.signal)
		return () => controller.abort()
	}, [loadAll])

	const refreshProviderStore = useCallback(async () => {
		try {
			const updated = await apiClient.get<{
				connected: any[]
				popular: any[]
				other: any[]
			}>("/providers")
			useProviderStore.getState().init(updated)
		} catch (err) {
			console.error("[opencode-config:refresh-providers]", err)
		}
	}, [])

	const rescan = useCallback(async () => {
		setRescanning(true)
		try {
			const result = await apiClient.post<OpenCodeDetection>("/providers/opencode/rescan", {})
			setDetection(result)
			setError(null)
			await refreshProviderStore()
		} catch (err) {
			setError(formatError(err, "Rescan failed"))
		} finally {
			setRescanning(false)
		}
	}, [refreshProviderStore])

	const saveSettings = useCallback(
		async (next: Partial<OpenCodeSettings>) => {
			setRescanning(true)
			try {
				const result = await apiClient.patch<OpenCodeDetection>(
					"/providers/opencode/settings",
					next,
				)
				setDetection(result)
				setSettings((prev) => (prev ? { ...prev, ...next } : prev))
				setError(null)
				setEditing(false)
				await refreshProviderStore()
			} catch (err) {
				setError(formatError(err, "Failed to save settings"))
			} finally {
				setRescanning(false)
			}
		},
		[refreshProviderStore],
	)

	const toggleEnabled = useCallback(async () => {
		if (!settings) return
		const next = !settings.enabled
		// Optimistic update so the toggle feels instant.
		setSettings({ ...settings, enabled: next })
		try {
			const result = await apiClient.patch<OpenCodeDetection>("/providers/opencode/settings", {
				enabled: next,
			})
			setDetection(result)
			setSettings((prev) => (prev ? { ...prev, enabled: next } : prev))
			setError(null)
			await refreshProviderStore()
		} catch (err) {
			// Roll back the optimistic update on failure.
			setSettings({ ...settings })
			setError(formatError(err, "Failed to update setting"))
		}
	}, [settings, refreshProviderStore])

	const enabled = settings?.enabled ?? true

	return (
		<div className={className}>
			<div className="mb-1 flex items-center justify-between gap-3">
				<h2 className="text-base font-semibold text-foreground">OpenCode</h2>
				<div className="flex items-center gap-3">
					{settings ? <ToggleSwitch checked={enabled} onChange={toggleEnabled} /> : null}
					{!editing ? (
						<button
							type="button"
							onClick={() => setEditing(true)}
							disabled={loading || !enabled}
							className="el-btn-pill-sm flex items-center gap-1.5 !bg-transparent text-muted shadow-[var(--shadow-inset)] hover:text-foreground disabled:opacity-50"
						>
							<span>Configure</span>
						</button>
					) : null}
					<button
						type="button"
						onClick={rescan}
						disabled={loading || rescanning || !enabled}
						className="el-btn-pill-sm flex items-center gap-1.5 !bg-transparent text-muted shadow-[var(--shadow-inset)] hover:text-foreground disabled:opacity-50"
					>
						{rescanning ? <Spinner /> : null}
						<span>{rescanning ? "Rescanning…" : "Rescan"}</span>
					</button>
				</div>
			</div>
			<p className="mb-4 text-xs text-muted">
				Route prompts through your local <code className="font-mono">opencode</code> CLI or a
				self-hosted OpenCode server. Models from every upstream provider OpenCode is connected to
				appear in the picker automatically.
			</p>

			<div className="el-card overflow-hidden">
				{loading && !detection ? (
					<div className="flex items-center gap-2 px-5 py-5 text-sm text-muted">
						<Spinner />
						<span>Checking OpenCode…</span>
					</div>
				) : detection ? (
					<OpenCodeStatusBody detection={detection} />
				) : error ? (
					<div className="flex items-center gap-2 px-5 py-5 text-sm text-danger">
						<ErrorIcon />
						<span>{error}</span>
					</div>
				) : null}
			</div>

			{editing && settings ? (
				<OpenCodeSettingsForm
					settings={settings}
					onCancel={() => setEditing(false)}
					onSave={saveSettings}
					busy={rescanning}
				/>
			) : null}

			{error && detection ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
		</div>
	)
}

/** Inline detection status (state + key facts). */
function OpenCodeStatusBody({ detection }: { detection: OpenCodeDetection }) {
	const status = statusFor(detection)
	const upstreamCount = detection.connectedUpstreamCount ?? 0

	return (
		<div className="divide-y divide-[var(--separator)]">
			<div className="flex items-center justify-between gap-6 px-5 py-4">
				<div className="min-w-0">
					<div className="text-sm font-medium text-foreground">Status</div>
					<div className="mt-0.5 text-xs text-muted">{status.description}</div>
				</div>
				<StatusPill tone={status.tone} label={status.label} />
			</div>

			<Row label="Mode">
				<span className="text-sm text-foreground">
					{detection.mode === "remote" ? "Remote server" : "Local CLI"}
				</span>
			</Row>

			{detection.mode === "remote" && detection.serverUrl ? (
				<Row label="Server URL">
					<code className="truncate font-mono text-xs text-foreground">{detection.serverUrl}</code>
				</Row>
			) : null}

			{detection.binaryPath ? (
				<Row label="Binary path">
					<code className="truncate font-mono text-xs text-foreground">{detection.binaryPath}</code>
				</Row>
			) : null}

			{detection.version ? (
				<Row label="Version">
					<code className="font-mono text-xs text-foreground">{detection.version}</code>
				</Row>
			) : null}

			{detection.connected ? (
				<Row label="Upstream providers">
					<span className="text-sm text-foreground">
						{upstreamCount} connected
						{detection.upstreamProviderIds && detection.upstreamProviderIds.length > 0 ? (
							<span className="ml-2 text-xs text-muted">
								({detection.upstreamProviderIds.slice(0, 5).join(", ")}
								{detection.upstreamProviderIds.length > 5 ? "…" : ""})
							</span>
						) : null}
					</span>
				</Row>
			) : null}

			{detection.versionWarning ? (
				<div className="mx-5 my-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
					<span>{detection.versionWarning}</span>
				</div>
			) : null}

			{detection.error ? (
				<div className="mx-5 my-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
					<span>{detection.error}</span>
				</div>
			) : null}

			{!detection.installed ? (
				<div className="px-5 py-4 text-xs text-muted">
					<p className="mb-1">
						Install OpenCode from{" "}
						<a
							href="https://opencode.ai"
							target="_blank"
							rel="noreferrer"
							className="text-accent underline underline-offset-2 hover:text-accent/80"
						>
							opencode.ai
						</a>{" "}
						or configure a remote server above.
					</p>
				</div>
			) : !detection.connected ? (
				<div className="px-5 py-4 text-xs text-muted">
					<p>
						Run <code className="font-mono text-foreground">opencode auth login</code> to connect
						upstream providers, then click Rescan.
					</p>
				</div>
			) : null}
		</div>
	)
}

/**
 * Form for editing connection settings (binary path / remote URL + password).
 *
 * The `enabled` toggle lives in the card header (not here) — this form is
 * about *how* OpenCode connects, not whether the provider is on.
 */
function OpenCodeSettingsForm({
	settings,
	onCancel,
	onSave,
	busy,
}: {
	settings: OpenCodeSettings
	onCancel: () => void
	onSave: (next: Partial<OpenCodeSettings>) => Promise<void>
	busy: boolean
}) {
	const [binaryPath, setBinaryPath] = useState(settings.binaryPath)
	const [serverUrl, setServerUrl] = useState(settings.serverUrl)
	const [serverPassword, setServerPassword] = useState(settings.serverPassword)

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		void onSave({
			binaryPath: binaryPath.trim(),
			serverUrl: serverUrl.trim(),
			serverPassword: serverPassword,
		})
	}

	return (
		<form onSubmit={handleSubmit} className="el-card mt-3 flex flex-col gap-4 px-5 py-4 text-sm">
			<Field
				label="Binary path"
				hint="Used when no server URL is set. Defaults to `opencode` on PATH."
			>
				<input
					type="text"
					value={binaryPath}
					onChange={(e) => setBinaryPath(e.target.value)}
					placeholder="opencode"
					className="block w-full rounded-lg border border-[var(--separator)] bg-surface px-3 py-2 text-sm text-foreground"
				/>
			</Field>

			<Field label="Server URL" hint="Leave blank to spawn a local OpenCode server on demand.">
				<input
					type="text"
					value={serverUrl}
					onChange={(e) => setServerUrl(e.target.value)}
					placeholder="http://127.0.0.1:4096"
					className="block w-full rounded-lg border border-[var(--separator)] bg-surface px-3 py-2 text-sm text-foreground"
				/>
			</Field>

			<Field
				label="Server password"
				hint="Stored in plain text on disk. Only used when Server URL is set."
			>
				<input
					type="password"
					value={serverPassword}
					onChange={(e) => setServerPassword(e.target.value)}
					placeholder="Optional"
					className="block w-full rounded-lg border border-[var(--separator)] bg-surface px-3 py-2 text-sm text-foreground"
				/>
			</Field>

			<div className="mt-1 flex items-center justify-end gap-2">
				<button
					type="button"
					onClick={onCancel}
					disabled={busy}
					className="el-btn-pill-sm !bg-transparent text-muted shadow-[var(--shadow-inset)] hover:text-foreground disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={busy}
					className="el-btn-pill-sm flex items-center gap-1.5 bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-50"
				>
					{busy ? <Spinner /> : null}
					<span>{busy ? "Saving…" : "Save & rescan"}</span>
				</button>
			</div>
		</form>
	)
}

function Field({
	label,
	hint,
	children,
}: {
	label: string
	hint?: string
	children: React.ReactNode
}) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-sm font-medium text-foreground">{label}</span>
			{children}
			{hint ? <span className="text-xs text-muted">{hint}</span> : null}
		</div>
	)
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-6 px-5 py-3">
			<div className="text-sm font-medium text-foreground">{label}</div>
			<div className="min-w-0 shrink">{children}</div>
		</div>
	)
}

function StatusPill({
	tone,
	label,
}: {
	tone: "success" | "warning" | "danger"
	label: string
}) {
	const styles: Record<typeof tone, string> = {
		success: "bg-success/15 text-success border-success/25",
		warning: "bg-warning/15 text-warning border-warning/25",
		danger: "bg-danger/15 text-danger border-danger/25",
	}
	return (
		<span
			className={cn(
				"flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
				styles[tone],
			)}
		>
			{tone === "success" ? <CheckIcon /> : tone === "danger" ? <ErrorIcon /> : null}
			<span>{label}</span>
		</span>
	)
}

function statusFor(detection: OpenCodeDetection): {
	tone: "success" | "warning" | "danger"
	label: string
	description: string
} {
	if (!detection.enabled) {
		return {
			tone: "warning",
			label: "Disabled",
			description: "OpenCode is hidden from the model picker. Toggle on to re-enable.",
		}
	}
	if (!detection.installed) {
		return {
			tone: "danger",
			label: "Not installed",
			description: "Install the OpenCode CLI or configure a remote server to use this provider.",
		}
	}
	if (!detection.connected) {
		return {
			tone: "warning",
			label: "Not connected",
			description:
				detection.error ?? "OpenCode is reachable but no upstream providers are configured.",
		}
	}
	const upstream = detection.connectedUpstreamCount ?? 0
	if (upstream === 0) {
		return {
			tone: "warning",
			label: "No upstream providers",
			description: "Connected to OpenCode, but no upstream providers are signed in.",
		}
	}
	return {
		tone: "success",
		label: "Connected",
		description: `Ready to route prompts through ${upstream} upstream provider${upstream === 1 ? "" : "s"}.`,
	}
}

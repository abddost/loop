import { useCallback, useEffect, useState } from "react"
import { apiClient } from "../../lib/api-client"
import { cn } from "../ui/cn"
import { CheckIcon, ErrorIcon, Spinner, formatError } from "./shared"

/**
 * Detection payload returned by `GET /providers/claude-code/status`.
 * Mirrors the `ClaudeCodeDetection` interface on the backend.
 */
interface ClaudeCodeDetection {
	installed: boolean
	authenticated: boolean
	binaryPath?: string
	version?: string
	accountEmail?: string
	subscriptionType?: string
	error?: string
	versionWarning?: string
}

/**
 * Settings card for the Claude Code CLI provider.
 *
 * Shows detection status (installed + authenticated) and provides a rescan
 * button the user can hit after running `claude login` or installing the
 * CLI. When connected, we display the resolved binary path, version, and
 * account email read from `~/.claude.json`.
 */
export function ClaudeCodeConfig({ className }: { className?: string }) {
	const [detection, setDetection] = useState<ClaudeCodeDetection | null>(null)
	const [loading, setLoading] = useState(true)
	const [rescanning, setRescanning] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async (signal?: AbortSignal) => {
		try {
			const result = await apiClient.get<ClaudeCodeDetection>("/providers/claude-code/status", {
				signal,
			})
			if (signal?.aborted) return
			setDetection(result)
			setError(null)
		} catch (err) {
			if (signal?.aborted) return
			setError(formatError(err, "Failed to check Claude Code CLI"))
		} finally {
			if (!signal?.aborted) setLoading(false)
		}
	}, [])

	useEffect(() => {
		const controller = new AbortController()
		load(controller.signal)
		return () => controller.abort()
	}, [load])

	const rescan = useCallback(async () => {
		setRescanning(true)
		try {
			const result = await apiClient.post<ClaudeCodeDetection>("/providers/claude-code/rescan", {})
			setDetection(result)
			setError(null)
		} catch (err) {
			setError(formatError(err, "Rescan failed"))
		} finally {
			setRescanning(false)
		}
	}, [])

	return (
		<div className={className}>
			<div className="mb-1 flex items-center justify-between">
				<h2 className="text-base font-semibold text-foreground">Claude Code CLI</h2>
				<button
					type="button"
					onClick={rescan}
					disabled={loading || rescanning}
					className="el-btn-pill-sm flex items-center gap-1.5 !bg-transparent text-muted shadow-[var(--shadow-inset)] hover:text-foreground disabled:opacity-50"
				>
					{rescanning ? <Spinner /> : null}
					<span>{rescanning ? "Rescanning…" : "Rescan"}</span>
				</button>
			</div>
			<p className="mb-4 text-xs text-muted">
				Route prompts through your locally-installed <code className="font-mono">claude</code>{" "}
				binary. Uses your own subscription — no API key required.
			</p>

			<div className="el-card overflow-hidden">
				{loading && !detection ? (
					<div className="flex items-center gap-2 px-5 py-5 text-sm text-muted">
						<Spinner />
						<span>Checking your machine…</span>
					</div>
				) : detection ? (
					<ClaudeCodeStatusBody detection={detection} />
				) : error ? (
					<div className="flex items-center gap-2 px-5 py-5 text-sm text-danger">
						<ErrorIcon />
						<span>{error}</span>
					</div>
				) : null}
			</div>

			{error && detection ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
		</div>
	)
}

/** Inner body that renders the detection result. */
function ClaudeCodeStatusBody({ detection }: { detection: ClaudeCodeDetection }) {
	const status = statusFor(detection)

	return (
		<div className="divide-y divide-[var(--separator)]">
			<div className="flex items-center justify-between gap-6 px-5 py-4">
				<div className="min-w-0">
					<div className="text-sm font-medium text-foreground">Status</div>
					<div className="mt-0.5 text-xs text-muted">{status.description}</div>
				</div>
				<StatusPill tone={status.tone} label={status.label} />
			</div>

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

			{detection.accountEmail ? (
				<Row label="Account">
					<span className="flex items-center gap-2">
						<span className="text-sm text-foreground">{detection.accountEmail}</span>
						{detection.subscriptionType ? (
							<SubscriptionBadge type={detection.subscriptionType} />
						) : null}
					</span>
				</Row>
			) : null}

			{detection.versionWarning ? (
				<div className="mx-5 my-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
					<span>{detection.versionWarning}</span>
				</div>
			) : null}

			{!detection.installed ? (
				<div className="px-5 py-4 text-xs text-muted">
					<p className="mb-2">
						Install Claude Code from{" "}
						<a
							href="https://docs.claude.com/en/docs/claude-code/overview"
							target="_blank"
							rel="noreferrer"
							className="text-accent underline underline-offset-2 hover:text-accent/80"
						>
							Anthropic's docs
						</a>
						, then click Rescan.
					</p>
				</div>
			) : !detection.authenticated ? (
				<div className="px-5 py-4 text-xs text-muted">
					<p>
						Run <code className="font-mono text-foreground">claude login</code> in your terminal,
						then click Rescan.
					</p>
				</div>
			) : null}
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

function SubscriptionBadge({ type }: { type: string }) {
	const label = type.charAt(0).toUpperCase() + type.slice(1)
	return (
		<span className="rounded-md border border-[var(--separator)] bg-surface/50 px-1.5 py-0.5 text-[10px] font-medium text-muted">
			{label}
		</span>
	)
}

function statusFor(detection: ClaudeCodeDetection): {
	tone: "success" | "warning" | "danger"
	label: string
	description: string
} {
	if (!detection.installed) {
		return {
			tone: "danger",
			label: "Not installed",
			description: "Install the Claude Code CLI to use this provider.",
		}
	}
	if (!detection.authenticated) {
		return {
			tone: "warning",
			label: "Not authenticated",
			description: "CLI found, but you haven't signed in yet.",
		}
	}
	return {
		tone: "success",
		label: "Connected",
		description: "Ready to route prompts through your local CLI.",
	}
}

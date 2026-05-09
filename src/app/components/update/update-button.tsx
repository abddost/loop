import { ArrowRotateCcw, Download } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback } from "react"
import { useUpdateState } from "../../hooks/use-update-state"
import { desktopBridge } from "../../lib/desktop-bridge"

/**
 * Sidebar pill that exposes the auto-updater state.
 *
 *   available  → "New Update"   (click → start download)
 *   downloading → "Downloading X%" (live percent, no click)
 *   downloaded  → "Restart"     (click → quit + install)
 *
 * Returns null in every other state so the sidebar stays clean when there
 * is nothing to act on.
 */
export function UpdateButton() {
	const state = useUpdateState()

	const onDownload = useCallback(() => {
		desktopBridge.downloadUpdate().catch(() => {})
	}, [])

	const onInstall = useCallback(() => {
		desktopBridge.installUpdate().catch(() => {})
	}, [])

	if (!state || !state.enabled) return null

	if (state.status === "available") {
		return (
			<button
				type="button"
				title={
					state.availableVersion
						? `Loop ${state.availableVersion} is available`
						: "Update available"
				}
				onClick={onDownload}
				className="el-surface-hover flex w-full items-center gap-2.5 px-2.5 py-1.5 text-sm font-medium text-[var(--accent-foreground,theme(colors.blue.400))] hover:text-[var(--accent-foreground-hover,theme(colors.blue.300))]"
			>
				<Download className="h-4 w-4" aria-hidden="true" />
				<span>New Update</span>
			</button>
		)
	}

	if (state.status === "downloading") {
		const pct = Math.max(0, Math.min(100, state.downloadPercent ?? 0))
		return (
			<div
				className="relative flex w-full items-center gap-2.5 overflow-hidden px-2.5 py-1.5 text-sm font-medium text-foreground/80"
				title={
					state.availableVersion
						? `Downloading Loop ${state.availableVersion}`
						: "Downloading update"
				}
				aria-live="polite"
				aria-label={`Downloading update, ${pct}%`}
			>
				<span
					className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--app-surface-hover)] transition-[width] duration-150 ease-out"
					style={{ width: `${pct}%` }}
				/>
				<Download className="relative h-4 w-4 animate-pulse" aria-hidden="true" />
				<span className="relative">Downloading {pct}%</span>
			</div>
		)
	}

	if (state.status === "downloaded") {
		return (
			<button
				type="button"
				title={
					state.downloadedVersion
						? `Restart to install Loop ${state.downloadedVersion}`
						: "Restart to install update"
				}
				onClick={onInstall}
				className="el-surface-hover flex w-full items-center gap-2.5 px-2.5 py-1.5 text-sm font-medium text-[var(--accent-foreground,theme(colors.green.400))] hover:text-[var(--accent-foreground-hover,theme(colors.green.300))]"
			>
				<ArrowRotateCcw className="h-4 w-4" aria-hidden="true" />
				<span>Restart</span>
			</button>
		)
	}

	return null
}

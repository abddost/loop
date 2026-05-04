import { useEffect, useRef, useState } from "react"
import { type DesktopUpdateState, desktopBridge } from "../lib/desktop-bridge"
import { useSnackbarStore } from "../stores/snackbar-store"

/**
 * Subscribes to desktop auto-update state. Reads the initial snapshot,
 * listens for changes from the main process, and pushes a snackbar when
 * the download completes (so the user sees the success even if the
 * sidebar update button is offscreen).
 */
export function useUpdateState(): DesktopUpdateState | null {
	const [state, setState] = useState<DesktopUpdateState | null>(null)
	const previousStatusRef = useRef<DesktopUpdateState["status"] | null>(null)
	const push = useSnackbarStore((s) => s.push)

	useEffect(() => {
		let mounted = true

		desktopBridge
			.getUpdateState()
			.then((initial) => {
				if (!mounted) return
				if (initial) {
					setState(initial)
					previousStatusRef.current = initial.status
				}
			})
			.catch(() => {})

		const unsubscribe = desktopBridge.onUpdateState((next) => {
			const prev = previousStatusRef.current
			previousStatusRef.current = next.status
			setState(next)

			// One-shot success toast on completion of download.
			if (prev !== "downloaded" && next.status === "downloaded") {
				push(
					`Loop ${next.downloadedVersion ?? next.availableVersion ?? ""} downloaded successfully — restart to install.`,
					"success",
					0,
				)
			}
		})

		return () => {
			mounted = false
			unsubscribe()
		}
	}, [push])

	return state
}

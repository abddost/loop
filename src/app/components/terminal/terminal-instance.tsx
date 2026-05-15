import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import { memo, useEffect, useRef } from "react"
import { apiClient } from "../../lib/api-client"
import { getTerminalColors, resolveThemeColors } from "../../lib/theme-engine"
import { useConfigStore } from "../../stores/config-store"
import { useTerminalStore } from "../../stores/terminal-store"
import { useUIStore } from "../../stores/ui-store"
import "@xterm/xterm/css/xterm.css"

interface TerminalInstanceProps {
	terminalId: string
	visible: boolean
}

/**
 * Wraps a single xterm.js Terminal instance connected to a server PTY via WebSocket.
 * Handles resize, reconnection, and cleanup.
 */
export const TerminalInstance = memo(function TerminalInstance({
	terminalId,
	visible,
}: TerminalInstanceProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const termRef = useRef<Terminal | null>(null)
	const fitAddonRef = useRef<FitAddon | null>(null)
	const wsRef = useRef<WebSocket | null>(null)
	const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		const { serverUrl } = useTerminalStore.getState()
		const directory = useUIStore.getState().activeDirectory
		if (!serverUrl || !directory) return

		// Create terminal
		const appearance = useConfigStore.getState().config.appearance
		const { colors } = resolveThemeColors(appearance)
		const term = new Terminal({
			cursorBlink: true,
			fontSize: appearance.codeFontSize,
			fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
			lineHeight: 1.35,
			scrollback: 5000,
			allowProposedApi: true,
			theme: getTerminalColors(colors),
		})

		const fitAddon = new FitAddon()
		const webLinksAddon = new WebLinksAddon()
		term.loadAddon(fitAddon)
		term.loadAddon(webLinksAddon)
		term.open(container)

		termRef.current = term
		fitAddonRef.current = fitAddon

		// Fit after render
		requestAnimationFrame(() => fitAddon.fit())

		// Connect WebSocket. Auth rides on the session cookie minted by the
		// SSE bootstrap; the directory still travels via query string
		// because WebSocket upgrades can't carry custom headers.
		const wsProto = serverUrl.startsWith("https") ? "wss" : "ws"
		const wsBase = serverUrl.replace(/^https?/, wsProto)
		const wsUrl = `${wsBase}/terminals/${terminalId}/ws?directory=${encodeURIComponent(directory)}`

		const ws = new WebSocket(wsUrl)
		wsRef.current = ws

		ws.onopen = () => {
			// Send initial size
			const { cols, rows } = term
			sendResize(terminalId, cols, rows)
			// Ask the shell to redraw its prompt at the post-resize size.
			// PTY is spawned at 80x24 before the client knows the container
			// size; Ctrl+L makes the shell clear + reprint cleanly.
			setTimeout(() => {
				if (ws.readyState === WebSocket.OPEN) ws.send("\x0c")
			}, 50)
		}

		ws.onmessage = (evt) => {
			term.write(typeof evt.data === "string" ? evt.data : new Uint8Array(evt.data))
		}

		ws.onclose = () => {
			// Only write message if terminal is still mounted
			if (termRef.current) {
				term.write("\r\n\x1b[90m[Connection closed]\x1b[0m\r\n")
			}
		}

		// Terminal input → WebSocket
		const dataDisposable = term.onData((data) => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(data)
			}
		})

		// Resize observer. Skips refit while the panel's height transition
		// is in flight — fit() is expensive and the parent will settle.
		// A single fit runs from the panelTransitioning effect below
		// once the transition ends.
		const observer = new ResizeObserver(() => {
			if (useTerminalStore.getState().panelTransitioning) return
			clearTimeout(resizeTimeoutRef.current)
			resizeTimeoutRef.current = setTimeout(() => {
				if (!fitAddonRef.current || !termRef.current) return
				fitAddonRef.current.fit()
				const { cols, rows } = termRef.current
				sendResize(terminalId, cols, rows)
			}, 50)
		})
		observer.observe(container)

		return () => {
			clearTimeout(resizeTimeoutRef.current)
			observer.disconnect()
			dataDisposable.dispose()
			ws.close()
			term.dispose()
			termRef.current = null
			fitAddonRef.current = null
			wsRef.current = null
		}
	}, [terminalId])

	// Re-fit when visibility changes
	useEffect(() => {
		if (visible && fitAddonRef.current) {
			requestAnimationFrame(() => fitAddonRef.current?.fit())
		}
	}, [visible])

	// Re-fit once the panel finishes its open/close transition. The
	// ResizeObserver skipped fits during the transition, so the xterm
	// grid may be out of sync until this runs.
	const panelTransitioning = useTerminalStore((s) => s.panelTransitioning)
	useEffect(() => {
		if (panelTransitioning || !visible || !fitAddonRef.current || !termRef.current) return
		requestAnimationFrame(() => {
			if (!fitAddonRef.current || !termRef.current) return
			fitAddonRef.current.fit()
			const { cols, rows } = termRef.current
			sendResize(terminalId, cols, rows)
		})
	}, [panelTransitioning, visible, terminalId])

	return <div ref={containerRef} className="h-full w-full" />
})

function sendResize(terminalId: string, cols: number, rows: number): void {
	apiClient.post(`/terminals/${terminalId}/resize`, { cols, rows }).catch(() => {
		// Resize failure is non-critical
	})
}

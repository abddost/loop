import type { GlobalEvent } from "@core/schema/event"

type EventHandler = (events: GlobalEvent[]) => void

/**
 * Single-connection SSE client with:
 * - 250ms reconnect on disconnect (exponential backoff up to 10s)
 * - 16ms frame coalescing via requestAnimationFrame batching
 * - 35s heartbeat timeout (force reconnect)
 * - Single connection for all workspaces
 */
class SSEClient {
	private eventSource: EventSource | null = null
	private baseUrl = ""
	private token = ""
	private handler: EventHandler | null = null
	private buffer: GlobalEvent[] = []
	private rafId: number | null = null
	private reconnectDelay = 250
	private maxReconnectDelay = 10_000
	private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
	private disposed = false

	init(baseUrl: string, token: string): void {
		this.baseUrl = baseUrl.replace(/\/$/, "")
		this.token = token
	}

	onEvents(handler: EventHandler): void {
		this.handler = handler
	}

	ensureConnected(): void {
		if (this.eventSource?.readyState === EventSource.OPEN) return
		if (this.eventSource?.readyState === EventSource.CONNECTING) return
		this.connect()
	}

	private connect(): void {
		if (this.disposed) return

		this.disconnect()

		const url = `${this.baseUrl}/global/events`
		// Note: EventSource doesn't support custom headers.
		// Auth is handled via query param for SSE.
		const eventSource = new EventSource(
			this.token ? `${url}?token=${encodeURIComponent(this.token)}` : url,
		)

		eventSource.onmessage = (e) => {
			this.resetHeartbeatTimer()
			try {
				const event = JSON.parse(e.data) as GlobalEvent
				this.buffer.push(event)
				this.scheduleFlush()
			} catch {
				// Ignore malformed events
			}
		}

		eventSource.onerror = () => {
			this.disconnect()
			if (!this.disposed) {
				setTimeout(() => this.connect(), this.reconnectDelay)
				this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
			}
		}

		eventSource.onopen = () => {
			this.reconnectDelay = 250 // Reset on successful connection
			this.resetHeartbeatTimer()
		}

		this.eventSource = eventSource
	}

	private scheduleFlush(): void {
		if (this.rafId !== null) return
		this.rafId = requestAnimationFrame(() => {
			this.rafId = null
			if (this.buffer.length > 0 && this.handler) {
				const events = this.buffer
				this.buffer = []
				this.handler(events)
			}
		})
	}

	private resetHeartbeatTimer(): void {
		if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
		this.heartbeatTimer = setTimeout(() => {
			// No heartbeat for 35s — force reconnect
			console.warn("[sse] Heartbeat timeout, reconnecting...")
			this.disconnect()
			this.connect()
		}, 35_000)
	}

	disconnect(): void {
		if (this.eventSource) {
			this.eventSource.close()
			this.eventSource = null
		}
		if (this.heartbeatTimer) {
			clearTimeout(this.heartbeatTimer)
			this.heartbeatTimer = null
		}
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId)
			this.rafId = null
		}
	}

	dispose(): void {
		this.disposed = true
		this.disconnect()
		this.buffer = []
		this.handler = null
	}
}

export const sseClient = new SSEClient()

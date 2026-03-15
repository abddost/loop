import type { GlobalEvent } from "@core/schema/event"

type EventHandler = (events: GlobalEvent[]) => void
type ConnectionHandler = () => void

/**
 * Coalescing key — events with the same key replace each other in the queue.
 * Only the latest state matters for these high-frequency events.
 * Returns null for non-coalesceable events (all get queued).
 */
function coalesceKey(event: GlobalEvent): string | null {
	switch (event.type) {
		case "session:status":
			return `ss:${event.directory}:${event.sessionId}`
		case "session:update":
			return `su:${event.directory}:${event.sessionId}`
		case "part:upsert":
			// Parts include `id` at runtime from the database layer
			return `pu:${event.directory}:${event.messageId}:${(event.part as Record<string, unknown>).id}`
		default:
			return null
	}
}

/**
 * Single-connection SSE client with production-grade resilience.
 *
 * Architecture:
 *   EventSource.onmessage → coalesce + buffer → RAF → handler(events[])
 *
 * Features:
 * - Event coalescing: high-frequency events (status, part updates) are
 *   deduplicated within each frame — only the latest value is dispatched.
 *   This prevents redundant Zustand store updates and React re-renders.
 *
 * - 16ms frame batching via requestAnimationFrame — all events within one
 *   frame are delivered as a single array. React 18 batches the resulting
 *   state updates into a single re-render.
 *
 * - Exponential backoff reconnection (250ms → 10s) with automatic reset
 *   on successful connection.
 *
 * - 35s heartbeat timeout — forces reconnect if server goes silent
 *   (server sends heartbeat every 30s).
 *
 * - Connection lifecycle: server.connected event triggers reconnection
 *   handler on subsequent connects (not the first), allowing the app to
 *   refetch stale state.
 *
 * - Single connection for all workspaces — events carry a `directory` field
 *   for routing to the correct workspace store.
 */
class SSEClient {
	private eventSource: EventSource | null = null
	private baseUrl = ""
	private token = ""

	// Event handling
	private handler: EventHandler | null = null
	private queue: GlobalEvent[] = []
	private coalescedIndex = new Map<string, number>()
	private rafId: number | null = null

	// Reconnection
	private reconnectDelay = 250
	private maxReconnectDelay = 10_000
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null

	// Heartbeat
	private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
	private static HEARTBEAT_TIMEOUT = 35_000

	// Connection state
	private onReconnectHandler: ConnectionHandler | null = null
	private disposed = false
	private wasEverConnected = false
	private connected = false

	init(baseUrl: string, token: string): void {
		this.baseUrl = baseUrl.replace(/\/$/, "")
		this.token = token
	}

	/** Register the event handler. Called with batched, coalesced events per frame. */
	onEvents(handler: EventHandler): void {
		this.handler = handler
	}

	/**
	 * Register a callback for reconnection events.
	 * Called when the SSE stream reconnects after a previous successful connection.
	 * Use this to refetch stale state (e.g., active session messages).
	 */
	onReconnect(handler: ConnectionHandler): void {
		this.onReconnectHandler = handler
	}

	/** Whether the SSE connection is currently open. */
	isConnected(): boolean {
		return this.connected
	}

	/** Ensure the SSE connection is active. Idempotent. */
	ensureConnected(): void {
		if (this.eventSource?.readyState === EventSource.OPEN) return
		if (this.eventSource?.readyState === EventSource.CONNECTING) return
		this.connect()
	}

	private connect(): void {
		if (this.disposed) return
		this.cleanup()

		const fullUrl = this.token
			? `${this.baseUrl}/global/events?token=${encodeURIComponent(this.token)}`
			: `${this.baseUrl}/global/events`

		console.debug("[sse] Connecting to", fullUrl)

		// EventSource cannot send custom headers.
		// Auth is handled via query param (server middleware supports both).
		const eventSource = new EventSource(fullUrl)

		eventSource.onmessage = (e) => {
			this.resetHeartbeatTimer()
			try {
				const event = JSON.parse(e.data) as GlobalEvent

				// Heartbeat — already reset the timer above, skip queueing
				if (event.type === "heartbeat") return

				// Connection handshake from server
				if (event.type === "server.connected") {
					this.connected = true
					if (this.wasEverConnected) {
						console.debug("[sse] Reconnected — triggering state refetch")
						this.onReconnectHandler?.()
					} else {
						console.debug("[sse] Connected")
					}
					this.wasEverConnected = true
					return
				}

				this.enqueue(event)
			} catch {
				// Malformed JSON — skip silently
			}
		}

		eventSource.onerror = () => {
			this.connected = false
			this.cleanup()
			if (!this.disposed) {
				console.debug(`[sse] Connection lost, reconnecting in ${this.reconnectDelay}ms`)
				this.reconnectTimer = setTimeout(() => {
					this.reconnectTimer = null
					this.connect()
				}, this.reconnectDelay)
				this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
			}
		}

		eventSource.onopen = () => {
			this.reconnectDelay = 250 // Reset backoff on successful connection
			this.resetHeartbeatTimer()
		}

		this.eventSource = eventSource
	}

	/**
	 * Enqueue an event with coalescing.
	 * Events with the same coalesce key replace each other in the queue,
	 * so only the latest state is dispatched on flush.
	 */
	private enqueue(event: GlobalEvent): void {
		const key = coalesceKey(event)
		if (key) {
			const existingIdx = this.coalescedIndex.get(key)
			if (existingIdx !== undefined) {
				this.queue[existingIdx] = event
				return
			}
			this.coalescedIndex.set(key, this.queue.length)
		}
		this.queue.push(event)
		this.scheduleFlush()
	}

	/** Schedule a RAF-based flush if not already scheduled. */
	private scheduleFlush(): void {
		if (this.rafId !== null) return
		this.rafId = requestAnimationFrame(() => {
			this.rafId = null
			this.flush()
		})
	}

	/** Deliver all queued events to the handler. */
	private flush(): void {
		if (this.queue.length === 0 || !this.handler) return
		const events = this.queue
		this.queue = []
		this.coalescedIndex.clear()
		this.handler(events)
	}

	private resetHeartbeatTimer(): void {
		if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
		this.heartbeatTimer = setTimeout(() => {
			console.warn("[sse] Heartbeat timeout, reconnecting...")
			this.connected = false
			this.cleanup()
			this.connect()
		}, SSEClient.HEARTBEAT_TIMEOUT)
	}

	/** Clean up connection resources without disposing. */
	private cleanup(): void {
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
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
	}

	/**
	 * Detach event handlers without destroying the connection.
	 * Used by React effect cleanup (StrictMode double-mount safe).
	 */
	detach(): void {
		this.handler = null
		this.onReconnectHandler = null
	}

	/** Disconnect and release all resources permanently. */
	dispose(): void {
		this.disposed = true
		this.flush() // Deliver any pending events
		this.cleanup()
		this.queue = []
		this.coalescedIndex.clear()
		this.handler = null
		this.onReconnectHandler = null
		this.connected = false
	}
}

export const sseClient = new SSEClient()

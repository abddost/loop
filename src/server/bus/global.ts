import type { GlobalEvent } from "@core/schema/event"
import { createLogger } from "../logger"

const log = createLogger("bus")

/**
 * Global event bus. Single instance for the entire server.
 * Aggregates all workspace events with directory field attached.
 * SSE endpoint subscribes to this.
 */
class GlobalBusImpl {
	private listeners = new Set<(event: GlobalEvent) => void>()

	/** Subscribe to all global events. Returns unsubscribe function. */
	subscribe(listener: (event: GlobalEvent) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	/** Emit a global event to all subscribers. */
	emit(event: GlobalEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event)
			} catch (e) {
				log.error("Listener error", { error: e })
			}
		}
	}
}

export const globalBus = new GlobalBusImpl()

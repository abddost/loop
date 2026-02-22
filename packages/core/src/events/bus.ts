/**
 * Global Event Bus -- all events, all sessions.
 * Pure in-memory pub/sub. No persistence, no sequence numbers.
 * Events are ephemeral notifications; the database is the source of truth.
 */

import type { StreamEvent } from '@coding-assistant/shared';

type EventListener = (event: StreamEvent) => void;

export class GlobalEventBus {
  private listeners = new Set<EventListener>();

  /**
   * Emit an event to all connected listeners (SSE endpoints).
   */
  emit(event: StreamEvent): void {
    const fullEvent = event;

    for (const listener of this.listeners) {
      try {
        listener(fullEvent);
      } catch (err) {
        console.error('Event listener error:', err);
      }
    }
  }

  addListener(fn: EventListener): void {
    this.listeners.add(fn);
  }

  removeListener(fn: EventListener): void {
    this.listeners.delete(fn);
  }
}

/** Singleton event bus */
export const globalEventBus = new GlobalEventBus();

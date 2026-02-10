/**
 * Global Event Bus -- all events, all sessions.
 * Assigns monotonic globalSeq to each event.
 */

import type { StreamEvent } from '@coding-assistant/shared';

type EventListener = (event: StreamEvent) => void;

export class GlobalEventBus {
  private listeners = new Set<EventListener>();
  private seq = 0;

  /**
   * Emit an event with a new globalSeq.
   * The caller provides everything except globalSeq.
   */
  emit(event: Omit<StreamEvent, 'globalSeq'>): StreamEvent {
    const fullEvent = { ...event, globalSeq: ++this.seq } as StreamEvent;

    // Broadcast to all connected listeners (SSE endpoints)
    for (const listener of this.listeners) {
      try {
        listener(fullEvent);
      } catch (err) {
        console.error('Event listener error:', err);
      }
    }

    return fullEvent;
  }

  /**
   * Add a listener (typically an SSE connection).
   */
  addListener(fn: EventListener): void {
    this.listeners.add(fn);
  }

  /**
   * Remove a listener (SSE disconnect).
   */
  removeListener(fn: EventListener): void {
    this.listeners.delete(fn);
  }

  /**
   * Current sequence number.
   */
  get currentSeq(): number {
    return this.seq;
  }

  /**
   * Set sequence (for initialization from persisted log).
   */
  setSeq(seq: number): void {
    this.seq = seq;
  }
}

/** Singleton event bus */
export const globalEventBus = new GlobalEventBus();

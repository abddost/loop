/**
 * SSE Pipe -- dumb delivery.
 *
 * Connects to the server's SSE endpoint and pushes events
 * into the EventStore. No routing, no filtering.
 */

import type { StreamEvent } from '@coding-assistant/shared';
import type { EventStore } from '../store/event-store';

export class SSEPipe {
  private source: EventSource | null = null;
  private store: EventStore;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: EventStore) {
    this.store = store;
  }

  connect(baseUrl: string, authToken?: string): void {
    this.disconnect();

    const url = authToken
      ? `${baseUrl}/api/events?token=${encodeURIComponent(authToken)}`
      : `${baseUrl}/api/events`;

    this.source = new EventSource(url);

    this.source.onmessage = (e) => {
      try {
        const event: StreamEvent = JSON.parse(e.data);
        this.store.append(event);
      } catch (err) {
        console.error('[sse] Failed to parse event:', err);
      }
    };

    this.source.onerror = () => {
      // EventSource auto-reconnects with Last-Event-ID
      // Missed events are replayed by the server
      console.warn('[sse] Connection error, auto-reconnecting...');
    };

    this.source.addEventListener('ping', () => {
      // Keep-alive ping, ignore
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  get connected(): boolean {
    return this.source?.readyState === EventSource.OPEN;
  }
}

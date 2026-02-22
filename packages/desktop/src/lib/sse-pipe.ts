/**
 * SSE Pipe -- dumb delivery with 16ms event batching + React transitions.
 *
 * Connects to the server's SSE endpoint and pushes events
 * into the EventStore. No routing, no filtering.
 *
 * Batching: Events arriving within 16ms of the last flush are queued
 * and flushed together, reducing React re-renders from ~50/sec to ~4/sec
 * during fast streaming. If no recent flush, events are processed immediately.
 *
 * Transitions: Store updates are wrapped in React's startTransition so
 * user interactions (typing, clicking) take priority over streaming renders.
 *
 * Reconnect: On receiving `server-connected`, the pipe fires its
 * `onReconnect` callback so the app can rehydrate from the REST API.
 */

import { startTransition } from 'react';
import type { StreamEvent } from '@coding-assistant/shared';
import type { EventStore } from '../store/event-store';
import { BATCH_INTERVAL_MS } from '../constants';

export class SSEPipe {
  private source: EventSource | null = null;
  private store: EventStore;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private queue: StreamEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushTime = 0;

  /** Called on every (re)connection so the app can rehydrate active session state. */
  onReconnect: (() => void) | null = null;

  private hasConnectedBefore = false;

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
        if ((event.type as string) === 'ping') return;

        // Server signals (re)connection -- rehydrate active session from API
        if ((event.type as string) === 'server-connected') {
          if (this.hasConnectedBefore && this.onReconnect) {
            this.onReconnect();
          }
          this.hasConnectedBefore = true;
          return;
        }

        if ((event.type as string) === 'tasks-changed') {
          window.dispatchEvent(new CustomEvent('tasks-changed', {
            detail: {
              workspaceId: (event as any).workspaceId,
              sessionId: (event as any).sessionId,
              taskListId: (event as any).taskListId,
              version: (event as any).version,
            },
          }));
          return;
        }

        this.enqueue(event);
      } catch (err) {
        console.error('[sse] Failed to parse event:', err);
      }
    };

    this.source.onerror = () => {
      console.warn('[sse] Connection error, auto-reconnecting...');
    };
  }

  disconnect(): void {
    this.flush();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  get connected(): boolean {
    return this.source?.readyState === EventSource.OPEN;
  }

  private enqueue(event: StreamEvent): void {
    this.queue.push(event);

    if (this.flushTimer) return;

    const elapsed = Date.now() - this.lastFlushTime;
    if (elapsed >= BATCH_INTERVAL_MS) {
      this.flush();
    } else {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, BATCH_INTERVAL_MS);
    }
  }

  private flush(): void {
    if (this.queue.length === 0) return;

    const events = this.queue;
    this.queue = [];
    this.lastFlushTime = Date.now();

    startTransition(() => {
      if (events.length === 1) {
        this.store.append(events[0]);
      } else {
        this.store.appendBatch(events);
      }
    });
  }
}

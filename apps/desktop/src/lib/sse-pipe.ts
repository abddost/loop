/**
 * SSE Pipe -- dumb delivery with 16ms event batching.
 *
 * Connects to the server's SSE endpoint and pushes events
 * into the EventStore. No routing, no filtering.
 *
 * Batching: Events arriving within 16ms of the last flush are queued
 * and flushed together, reducing React re-renders from ~50/sec to ~4/sec
 * during fast streaming. If no recent flush, events are processed immediately.
 */

import type { StreamEvent } from '@coding-assistant/shared';
import type { EventStore } from '../store/event-store';
import { BATCH_INTERVAL_MS } from '../constants';

export class SSEPipe {
  private source: EventSource | null = null;
  private store: EventStore;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Batching state
  private queue: StreamEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushTime = 0;

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
        if ((event.type as string) === 'ping') return; // ignore keep-alive
        this.enqueue(event);
      } catch (err) {
        console.error('[sse] Failed to parse event:', err);
      }
    };

    this.source.onerror = () => {
      // EventSource auto-reconnects with Last-Event-ID
      // Missed events are replayed by the server
      console.warn('[sse] Connection error, auto-reconnecting...');
    };
  }

  disconnect(): void {
    // Flush any remaining queued events
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

  /**
   * Enqueue an event for batched delivery.
   * If we haven't flushed recently (within BATCH_INTERVAL_MS), flush immediately.
   * Otherwise, schedule a flush after BATCH_INTERVAL_MS to batch with future events.
   */
  private enqueue(event: StreamEvent): void {
    this.queue.push(event);

    // If a flush timer is already scheduled, let it handle this event
    if (this.flushTimer) return;

    const elapsed = Date.now() - this.lastFlushTime;
    if (elapsed >= BATCH_INTERVAL_MS) {
      // No recent flush -- process immediately to avoid latency
      this.flush();
    } else {
      // Recent flush -- batch with a short timer
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, BATCH_INTERVAL_MS);
    }
  }

  /**
   * Flush all queued events to the store in one batch.
   * The store's appendBatch method applies all events before notifying React,
   * resulting in a single re-render for the entire batch.
   */
  private flush(): void {
    if (this.queue.length === 0) return;

    const events = this.queue;
    this.queue = [];
    this.lastFlushTime = Date.now();

    // Use batch append if available, otherwise fall back to individual appends
    if (events.length === 1) {
      this.store.append(events[0]);
    } else {
      this.store.appendBatch(events);
    }
  }
}

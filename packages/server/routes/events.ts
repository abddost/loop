/**
 * SSE events route -- broadcast pipe with serialized write queue.
 *
 * Design: broadcasts ALL events to the single SSE connection.
 * No subscribe/unsubscribe. Every event carries { workspaceId, sessionId }.
 * The client stores by key.
 *
 * Write queue: Events are serialized through a queue to prevent
 * concurrent stream.writeSSE() calls (the event bus fires synchronously
 * without awaiting). Under backpressure (queue > 100), non-critical
 * delta events are dropped to prevent unbounded memory growth.
 *
 * Event replay on reconnect uses the database-backed ReplayLog
 * (initialized in services.ts) instead of an in-memory array.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { globalEventBus } from '@coding-assistant/core';
import type { StreamEvent } from '@coding-assistant/shared';
import { getReplayLog } from '../services.js';

/** Max queued events before backpressure kicks in */
const MAX_QUEUE_SIZE = 100;

/** Event types that can be dropped under backpressure (deltas are reconstructed by done events) */
const DROPPABLE_TYPES = new Set(['text-delta', 'reasoning-delta', 'tool-call-delta']);

export const eventsRouter = new Hono()
  .get('/', async (c) => {
    return streamSSE(c, async (stream) => {
      const lastEventId = c.req.header('Last-Event-ID');

      // Replay missed events on reconnect using database-backed log
      if (lastEventId) {
        const seq = parseInt(lastEventId, 10);
        if (!isNaN(seq)) {
          try {
            const replayLog = getReplayLog();
            const missed = replayLog.getAfter(seq);
            for (const evt of missed) {
              await stream.writeSSE({
                data: JSON.stringify(evt),
                id: String(evt.globalSeq),
              });
            }
          } catch (err) {
            console.error('[events] Failed to replay events:', err);
          }
        }
      }

      // ── Serialized write queue with backpressure ───────────────────
      // Prevents concurrent stream.writeSSE() calls that can cause
      // message interleaving and unbounded promise accumulation.

      const writeQueue: StreamEvent[] = [];
      let draining = false;
      let closed = false;

      async function drain(): Promise<void> {
        if (draining || closed) return;
        draining = true;
        try {
          while (writeQueue.length > 0 && !closed) {
            const event = writeQueue.shift()!;
            await stream.writeSSE({
              data: JSON.stringify(event),
              id: String(event.globalSeq),
            });
          }
        } catch {
          // Connection closed -- clean up
          closed = true;
          writeQueue.length = 0;
          globalEventBus.removeListener(listener);
        } finally {
          draining = false;
        }
      }

      function enqueue(event: StreamEvent): void {
        if (closed) return;

        // Backpressure: if queue is full, drop non-critical delta events.
        // The corresponding *-done events carry the full content, so
        // the client will self-heal on the next structural event.
        if (writeQueue.length >= MAX_QUEUE_SIZE && DROPPABLE_TYPES.has(event.type)) {
          return;
        }

        writeQueue.push(event);
        // Kick off drain if not already running (fire-and-forget is safe
        // here because drain() serializes writes internally)
        void drain();
      }

      const listener = (event: StreamEvent) => {
        enqueue(event);
      };

      globalEventBus.addListener(listener);

      stream.onAbort(() => {
        closed = true;
        writeQueue.length = 0;
        globalEventBus.removeListener(listener);
      });

      // Keep alive with periodic comments
      const keepAlive = setInterval(async () => {
        if (closed) {
          clearInterval(keepAlive);
          return;
        }
        try {
          await stream.writeSSE({
            data: JSON.stringify({ type: 'ping' }),
            id: '',
          });
        } catch {
          closed = true;
          clearInterval(keepAlive);
          globalEventBus.removeListener(listener);
        }
      }, 30_000);

      // Keep connection alive until abort
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(keepAlive);
          resolve();
        });
      });
    });
  });

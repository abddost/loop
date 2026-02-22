/**
 * SSE events route -- broadcast pipe with serialized write queue.
 *
 * Events are ephemeral in-memory notifications. On reconnect, the client
 * re-fetches current state from the REST API (no server-side replay).
 * A `server-connected` event is sent on each new connection so the
 * client knows to rehydrate.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { globalEventBus } from '@coding-assistant/core';
import type { StreamEvent } from '@coding-assistant/shared';

const MAX_QUEUE_SIZE = 100;

const DROPPABLE_TYPES = new Set(['text-delta', 'reasoning-delta', 'tool-call-delta']);

export const eventsRouter = new Hono()
  .get('/', async (c) => {
    return streamSSE(c, async (stream) => {
      // Signal the client that this is a (re)connection -- client should rehydrate
      await stream.writeSSE({
        data: JSON.stringify({ type: 'server-connected' }),
        id: '',
      });

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
              id: '',
            });
          }
        } catch {
          closed = true;
          writeQueue.length = 0;
          globalEventBus.removeListener(listener);
        } finally {
          draining = false;
        }
      }

      function enqueue(event: StreamEvent): void {
        if (closed) return;

        if (writeQueue.length >= MAX_QUEUE_SIZE && DROPPABLE_TYPES.has(event.type)) {
          return;
        }

        writeQueue.push(event);
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

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(keepAlive);
          resolve();
        });
      });
    });
  });

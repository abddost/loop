/**
 * SSE events route -- dumb broadcast pipe.
 *
 * Design: broadcasts ALL events to the single SSE connection.
 * No subscribe/unsubscribe. Every event carries { workspaceId, sessionId }.
 * The client stores by key.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { globalEventBus } from '@coding-assistant/core';
import type { StreamEvent } from '@coding-assistant/shared';

// Simple in-memory event log for replay (in production, use EventLogRepository)
const eventLog: StreamEvent[] = [];
const MAX_LOG_SIZE = 10000;

// Listen to all events and store for replay
globalEventBus.addListener((event) => {
  eventLog.push(event);
  if (eventLog.length > MAX_LOG_SIZE) {
    eventLog.splice(0, eventLog.length - MAX_LOG_SIZE);
  }
});

function getEventsAfter(seq: number): StreamEvent[] {
  return eventLog.filter((e) => e.globalSeq > seq);
}

export const eventsRouter = new Hono()
  .get('/', async (c) => {
    return streamSSE(c, async (stream) => {
      const lastEventId = c.req.header('Last-Event-ID');

      // Replay missed events on reconnect
      if (lastEventId) {
        const seq = parseInt(lastEventId, 10);
        if (!isNaN(seq)) {
          const missed = getEventsAfter(seq);
          for (const evt of missed) {
            await stream.writeSSE({
              data: JSON.stringify(evt),
              event: evt.type,
              id: String(evt.globalSeq),
            });
          }
        }
      }

      // Broadcast all live events -- no filtering
      const listener = async (event: StreamEvent) => {
        try {
          await stream.writeSSE({
            data: JSON.stringify(event),
            event: event.type,
            id: String(event.globalSeq),
          });
        } catch {
          // Connection closed
          globalEventBus.removeListener(listener);
        }
      };

      globalEventBus.addListener(listener);

      stream.onAbort(() => {
        globalEventBus.removeListener(listener);
      });

      // Keep alive with periodic comments
      const keepAlive = setInterval(async () => {
        try {
          await stream.writeSSE({
            data: '',
            event: 'ping',
            id: '',
          });
        } catch {
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

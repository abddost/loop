/**
 * SSE events route -- dumb broadcast pipe.
 *
 * Design: broadcasts ALL events to the single SSE connection.
 * No subscribe/unsubscribe. Every event carries { workspaceId, sessionId }.
 * The client stores by key.
 *
 * Event replay on reconnect uses the database-backed ReplayLog
 * (initialized in services.ts) instead of an in-memory array.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { globalEventBus } from '@coding-assistant/core';
import type { StreamEvent } from '@coding-assistant/shared';
import { getReplayLog } from '../services.js';

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

      // Broadcast all live events -- no filtering
      const listener = async (event: StreamEvent) => {
        try {
          await stream.writeSSE({
            data: JSON.stringify(event),
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
            data: JSON.stringify({ type: 'ping' }),
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

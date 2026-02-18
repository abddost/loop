/**
 * Event log persistence repository -- global monotonic sequence.
 */

import type { StreamEvent } from '@coding-assistant/shared';
import { BaseRepository } from './base-repo.js';

interface EventRow {
  globalSeq: number;
  workspaceId: string;
  sessionId: string;
  eventType: string;
  eventDataJson: string;
  createdAt: string;
}

export class EventLogRepository extends BaseRepository {
  append(event: StreamEvent): number {
    const result = this.stmt(`
      INSERT INTO event_log (workspaceId, sessionId, eventType, eventDataJson, createdAt)
      VALUES ($workspaceId, $sessionId, $eventType, $eventDataJson, $createdAt)
    `).run({
      $workspaceId: event.workspaceId,
      $sessionId: event.sessionId,
      $eventType: event.type,
      $eventDataJson: this.toJson(event),
      $createdAt: event.timestamp,
    });

    return Number(result.lastInsertRowid);
  }

  /**
   * Batch-append multiple events in a single transaction.
   * Reduces per-event SQLite overhead for structural events.
   */
  batchAppend(events: StreamEvent[]): void {
    if (events.length === 0) return;
    this.transaction(() => {
      const insert = this.stmt(`
        INSERT INTO event_log (workspaceId, sessionId, eventType, eventDataJson, createdAt)
        VALUES ($workspaceId, $sessionId, $eventType, $eventDataJson, $createdAt)
      `);
      for (const event of events) {
        insert.run({
          $workspaceId: event.workspaceId,
          $sessionId: event.sessionId,
          $eventType: event.type,
          $eventDataJson: this.toJson(event),
          $createdAt: event.timestamp,
        });
      }
    });
  }

  getAfter(globalSeq: number, limit: number = 1000): StreamEvent[] {
    const rows = this.stmt(`
      SELECT globalSeq, workspaceId, sessionId, eventType, eventDataJson, createdAt
      FROM event_log
      WHERE globalSeq > ?
      ORDER BY globalSeq ASC
      LIMIT ?
    `).all(globalSeq, limit) as EventRow[];

    return rows.map((row) => {
      const event = this.parseJson<StreamEvent>(row.eventDataJson)!;
      // Return new object with correct globalSeq from DB (avoids mutating parsed object)
      return { ...event, globalSeq: row.globalSeq };
    });
  }

  getLatestSeq(): number {
    const row = this.stmt(`
      SELECT MAX(globalSeq) as seq FROM event_log
    `).get() as { seq: number | null } | null;
    return row?.seq ?? 0;
  }

  getSessionEvents(sessionId: string, afterSeq: number = 0): StreamEvent[] {
    const rows = this.stmt(`
      SELECT globalSeq, eventDataJson FROM event_log
      WHERE sessionId = ? AND globalSeq > ?
      ORDER BY globalSeq ASC
    `).all(sessionId, afterSeq) as Pick<EventRow, 'globalSeq' | 'eventDataJson'>[];

    return rows.map((row) => {
      const event = this.parseJson<StreamEvent>(row.eventDataJson)!;
      return { ...event, globalSeq: row.globalSeq };
    });
  }

  prune(beforeSeq: number): number {
    const result = this.stmt(`
      DELETE FROM event_log WHERE globalSeq < ?
    `).run(beforeSeq);
    return result.changes;
  }
}

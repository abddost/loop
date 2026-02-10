/**
 * Event log persistence repository -- global monotonic sequence.
 */

import type Database from 'better-sqlite3';
import type { StreamEvent } from '@coding-assistant/shared';

interface EventRow {
  globalSeq: number;
  workspaceId: string;
  sessionId: string;
  eventType: string;
  eventDataJson: string;
  createdAt: string;
}

export class EventLogRepository {
  constructor(private db: Database.Database) {}

  append(event: StreamEvent): number {
    const result = this.db.prepare(`
      INSERT INTO event_log (workspaceId, sessionId, eventType, eventDataJson, createdAt)
      VALUES (@workspaceId, @sessionId, @eventType, @eventDataJson, @createdAt)
    `).run({
      workspaceId: event.workspaceId,
      sessionId: event.sessionId,
      eventType: event.type,
      eventDataJson: JSON.stringify(event),
      createdAt: event.timestamp,
    });

    return Number(result.lastInsertRowid);
  }

  getAfter(globalSeq: number, limit: number = 1000): StreamEvent[] {
    const rows = this.db.prepare(`
      SELECT globalSeq, workspaceId, sessionId, eventType, eventDataJson, createdAt
      FROM event_log
      WHERE globalSeq > ?
      ORDER BY globalSeq ASC
      LIMIT ?
    `).all(globalSeq, limit) as EventRow[];

    return rows.map((row) => {
      const event = JSON.parse(row.eventDataJson) as StreamEvent;
      // Ensure globalSeq is correct from DB
      (event as StreamEvent).globalSeq = row.globalSeq;
      return event;
    });
  }

  getLatestSeq(): number {
    const row = this.db.prepare(`
      SELECT MAX(globalSeq) as seq FROM event_log
    `).get() as { seq: number | null };
    return row.seq ?? 0;
  }

  getSessionEvents(sessionId: string, afterSeq: number = 0): StreamEvent[] {
    const rows = this.db.prepare(`
      SELECT globalSeq, eventDataJson FROM event_log
      WHERE sessionId = ? AND globalSeq > ?
      ORDER BY globalSeq ASC
    `).all(sessionId, afterSeq) as Pick<EventRow, 'globalSeq' | 'eventDataJson'>[];

    return rows.map((row) => {
      const event = JSON.parse(row.eventDataJson) as StreamEvent;
      event.globalSeq = row.globalSeq;
      return event;
    });
  }

  prune(beforeSeq: number): number {
    const result = this.db.prepare(`
      DELETE FROM event_log WHERE globalSeq < ?
    `).run(beforeSeq);
    return result.changes;
  }
}

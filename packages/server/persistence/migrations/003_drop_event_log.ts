/**
 * Migration 003 -- Drop event_log table.
 *
 * Events are now purely in-memory (ephemeral notifications).
 * The database (messages/parts) is the source of truth.
 * On SSE reconnect, the client re-fetches state from the REST API
 * instead of replaying persisted events.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  const row = db.query('SELECT COUNT(*) as count FROM migrations WHERE id = 3').get() as { count: number };
  if (row.count > 0) return;

  db.exec('DROP TABLE IF EXISTS event_log');
  db.exec("INSERT INTO migrations (id, name) VALUES (3, '003_drop_event_log')");
}

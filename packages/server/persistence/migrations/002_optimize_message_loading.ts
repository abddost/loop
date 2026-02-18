/**
 * Migration 002 -- Denormalize sessionId onto message_parts for faster session-level queries.
 *
 * Adds a sessionId column to message_parts so we can fetch all parts for a session
 * in a single query (WHERE sessionId = ?) instead of joining through messages.
 * This is the same pattern opencode uses (PartTable has session_id).
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  const row = db.query('SELECT COUNT(*) as count FROM migrations WHERE id = 2').get() as { count: number };
  if (row.count > 0) return;

  // Add sessionId column to message_parts
  db.exec('ALTER TABLE message_parts ADD COLUMN sessionId TEXT');

  // Backfill from messages table
  db.exec(`
    UPDATE message_parts SET sessionId = (
      SELECT m.sessionId FROM messages m WHERE m.id = message_parts.messageId
    )
  `);

  // Add index for session-level part queries
  db.exec('CREATE INDEX IF NOT EXISTS idx_parts_session ON message_parts(sessionId)');

  // Track migration
  db.exec("INSERT INTO migrations (id, name) VALUES (2, '002_optimize_message_loading')");
}

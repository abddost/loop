/**
 * Migration 004 -- Add composite index for session sort.
 *
 * The query `WHERE workspaceId = ? ORDER BY updatedAt DESC` previously
 * used only idx_sessions_workspace(workspaceId), requiring an in-memory
 * sort for the ORDER BY. This composite index covers both the filter
 * and the sort, so SQLite walks the B-tree in order.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  const row = db.query('SELECT COUNT(*) as count FROM migrations WHERE id = 4').get() as { count: number };
  if (row.count > 0) return;

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_workspace_updated
      ON sessions(workspaceId, updatedAt DESC)
  `);

  db.exec("INSERT INTO migrations (id, name) VALUES (4, '004_add_sort_indexes')");
}

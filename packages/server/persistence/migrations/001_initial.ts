/**
 * Initial database migration -- creates all core tables.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rootPath TEXT NOT NULL UNIQUE,
      configJson TEXT DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New Session',
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'busy', 'retry', 'error')),
      agentId TEXT NOT NULL DEFAULT 'build',
      parentSessionId TEXT REFERENCES sessions(id),
      forkMessageIndex INTEGER,
      summaryText TEXT,
      configOverridesJson TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspaceId);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parentSessionId);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
      "index" INTEGER NOT NULL,
      modelId TEXT,
      finishReason TEXT,
      usageJson TEXT,
      errorJson TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionId, "index");

    CREATE TABLE IF NOT EXISTS message_parts (
      id TEXT PRIMARY KEY,
      messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      "index" INTEGER NOT NULL,
      type TEXT NOT NULL,
      dataJson TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_parts_message ON message_parts(messageId, "index");

    CREATE TABLE IF NOT EXISTS event_log (
      globalSeq INTEGER PRIMARY KEY AUTOINCREMENT,
      workspaceId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      eventType TEXT NOT NULL,
      eventDataJson TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_workspace_session ON event_log(workspaceId, sessionId);
    CREATE INDEX IF NOT EXISTS idx_events_seq ON event_log(globalSeq);

    CREATE TABLE IF NOT EXISTS permission_grants (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      scopePattern TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('once', 'always')),
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_grants_session ON permission_grants(sessionId);

    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      appliedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO migrations (id, name) VALUES (1, '001_initial');
  `);
}

export function down(db: Database): void {
  db.exec(`
    DROP TABLE IF EXISTS permission_grants;
    DROP TABLE IF EXISTS event_log;
    DROP TABLE IF EXISTS message_parts;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS workspaces;
    DROP TABLE IF EXISTS migrations;
  `);
}

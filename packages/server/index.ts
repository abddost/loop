/**
 * Server entry point -- bootstrap Hono server on dynamic port.
 *
 * Initialization order:
 * 1. Initialize SQLite database and run migrations
 * 2. Create repositories from the database
 * 3. Create managers with repository injection (WorkspaceManager, SessionManager)
 * 4. Create ReplayLog and initialize globalEventBus sequence from persisted log
 * 5. Wire event persistence: every bus event is persisted via ReplayLog
 * 6. Restore persisted workspaces and their sessions from the database
 * 7. Create the Hono app and start serving
 */

import { createApp } from './app.js';
import { initServices } from './services.js';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from '@coding-assistant/shared';
import {
  getDatabase,
  runInitialMigration,
  closeDatabase,
  WorkspaceRepository,
  SessionRepository,
  MessageRepository,
  EventLogRepository,
} from '@coding-assistant/persistence';
import {
  WorkspaceManager,
  SessionManager,
  ReplayLog,
  globalEventBus,
} from '@coding-assistant/core';

// Read config from environment (injected by Tauri sidecar)
const port = parseInt(process.env.PORT ?? String(DEFAULT_SERVER_PORT), 10);
const host = process.env.HOST ?? DEFAULT_SERVER_HOST;
const authSecret = process.env.AUTH_SECRET ?? crypto.randomUUID();

// --- 1. Initialize database ---
console.log('[server] Initializing database...');
const db = getDatabase();
runInitialMigration(db);
console.log('[server] Database initialized and migrations applied');

// --- 2. Create repositories ---
const workspaceRepo = new WorkspaceRepository(db);
const sessionRepo = new SessionRepository(db);
const messageRepo = new MessageRepository(db);
const eventLogRepo = new EventLogRepository(db);

// --- 3. Create managers with persistence ---
const workspaceManager = new WorkspaceManager(workspaceRepo);
const sessionManager = new SessionManager(sessionRepo, messageRepo);

// --- 4. Create ReplayLog and initialize event bus sequence ---
const replayLog = new ReplayLog(eventLogRepo);
replayLog.initialize();
console.log(`[server] Event bus sequence initialized at ${globalEventBus.currentSeq}`);

// --- 5. Wire event persistence: persist every emitted event ---
globalEventBus.addListener((event) => {
  try {
    replayLog.append(event);
  } catch (err) {
    console.error('[server] Failed to persist event:', err);
  }
});

// --- 6. Register services for routes ---
initServices(workspaceManager, sessionManager, replayLog);

// --- 7. Restore persisted workspaces and sessions ---
(async () => {
  try {
    await workspaceManager.restore();
    // Restore sessions for each workspace
    for (const workspace of workspaceManager.list()) {
      sessionManager.restoreForWorkspace(workspace);
    }
    console.log(
      `[server] Restored ${workspaceManager.list().length} workspace(s) with sessions`,
    );
  } catch (err) {
    console.error('[server] Failed to restore state:', err);
  }

  // --- 8. Create app and start serving ---
  const app = createApp(authSecret);

  console.log(`[server] Starting on ${host}:${port}`);
  console.log(`[server] Auth secret: ${authSecret.slice(0, 8)}...`);

  const server = Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
    idleTimeout: 255, // max value (seconds) -- prevent SSE connections from being killed
  });

  console.log(`[server] Listening on http://${server.hostname}:${server.port}`);

  // Graceful shutdown
  const shutdown = () => {
    console.log('[server] Shutting down...');
    // Dispose all workspaces (kills processes, closes watchers)
    workspaceManager[Symbol.dispose]();
    // Close database
    closeDatabase();
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();

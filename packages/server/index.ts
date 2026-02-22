/**
 * Server entry point -- bootstrap Hono server on dynamic port.
 *
 * Initialization order:
 * 1. Initialize SQLite database and run migrations
 * 2. Create repositories from the database
 * 3. Create managers with repository injection (WorkspaceManager, SessionManager)
 * 4. Register services for routes
 * 5. Create the Hono app and start serving immediately
 * 6. Restore persisted workspaces and sessions in background (non-blocking)
 */

import { createApp } from './app.js';
import { initServices } from './services.js';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from '@coding-assistant/shared';
import {
  getDatabase,
  runInitialMigration,
  runMigration002,
  runMigration003,
  runMigration004,
  closeDatabase,
  WorkspaceRepository,
  SessionRepository,
  MessageRepository,
} from './persistence/index.js';
import {
  WorkspaceManager,
  SessionManager,
} from '@coding-assistant/core';

const port = parseInt(process.env.PORT ?? String(DEFAULT_SERVER_PORT), 10);
const host = process.env.HOST ?? DEFAULT_SERVER_HOST;
const authSecret = process.env.AUTH_SECRET ?? crypto.randomUUID();

// --- 1. Initialize database ---
console.log('[server] Initializing database...');
const db = getDatabase();
runInitialMigration(db);
runMigration002(db);
runMigration003(db);
runMigration004(db);
console.log('[server] Database initialized and migrations applied');

// --- 2. Create repositories ---
const workspaceRepo = new WorkspaceRepository(db);
const sessionRepo = new SessionRepository(db);
const messageRepo = new MessageRepository(db);

// --- 3. Create managers with persistence ---
const workspaceManager = new WorkspaceManager(workspaceRepo);
const sessionManager = new SessionManager(sessionRepo, messageRepo);

// --- 4. Register services for routes ---
initServices(workspaceManager, sessionManager, messageRepo);

// --- 5. Create app and start serving immediately ---
const app = createApp(authSecret);

console.log(`[server] Starting on ${host}:${port}`);
console.log(`[server] Auth secret: ${authSecret.slice(0, 8)}...`);

const server = Bun.serve({
  fetch: app.fetch,
  port,
  hostname: host,
  idleTimeout: 255,
});

console.log(`[server] Listening on http://${server.hostname}:${server.port}`);

// Graceful shutdown
const shutdown = () => {
  console.log('[server] Shutting down...');
  workspaceManager[Symbol.dispose]();
  closeDatabase();
  server.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- 6. Restore persisted workspaces and sessions in background ---
(async () => {
  try {
    await workspaceManager.restore();
    for (const workspace of workspaceManager.list()) {
      workspace.sessionManager = sessionManager;
      sessionManager.restoreForWorkspace(workspace);
    }
    console.log(
      `[server] Restored ${workspaceManager.list().length} workspace(s) with sessions`,
    );
  } catch (err) {
    console.error('[server] Failed to restore state:', err);
  }
})();

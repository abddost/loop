/**
 * Server entry point -- bootstrap Hono server on dynamic port.
 *
 * Initialization order:
 * 1. Initialize SQLite database and run migrations
 * 2. Create repositories from the database
 * 3. Create managers with repository injection (WorkspaceManager, SessionManager)
 * 4. Create ReplayLog and initialize globalEventBus sequence from persisted log
 * 5. Wire event persistence: every bus event is persisted via ReplayLog
 * 6. Register services for routes
 * 7. Create the Hono app and start serving immediately
 * 8. Restore persisted workspaces and sessions in background (non-blocking)
 */

import { createApp } from './app.js';
import { initServices } from './services.js';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from '@coding-assistant/shared';
import {
  getDatabase,
  runInitialMigration,
  runMigration002,
  closeDatabase,
  WorkspaceRepository,
  SessionRepository,
  MessageRepository,
  EventLogRepository,
} from './persistence/index.js';
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
runMigration002(db);
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

// --- 5. Wire event persistence: persist structural events only ---
// Delta events (text-delta, reasoning-delta, tool-call-delta, bash-output) are skipped
// because the corresponding *-done events carry full content, which is sufficient for
// SSE reconnect replay. This eliminates ~80-90% of event_log INSERTs during streaming.
const SKIP_PERSIST_TYPES = new Set([
  'text-delta',
  'reasoning-delta',
  'tool-call-delta',
  'bash-output',
]);

// Batch structural events and flush every 100ms or 50 events
const EVENT_FLUSH_INTERVAL_MS = 100;
const EVENT_FLUSH_BATCH_SIZE = 50;
let eventBuffer: import('@coding-assistant/shared').StreamEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushEventBuffer() {
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer;
  eventBuffer = [];
  flushTimer = null;
  try {
    eventLogRepo.batchAppend(batch);
  } catch (err) {
    console.error('[server] Failed to persist event batch:', err);
  }
}

globalEventBus.addListener((event) => {
  if (SKIP_PERSIST_TYPES.has(event.type)) return;
  eventBuffer.push(event);
  if (eventBuffer.length >= EVENT_FLUSH_BATCH_SIZE) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushEventBuffer();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushEventBuffer, EVENT_FLUSH_INTERVAL_MS);
  }
});

// --- 6. Register services for routes ---
initServices(workspaceManager, sessionManager, replayLog, messageRepo);

// --- 7. Create app and start serving immediately ---
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

// --- Auto-prune event log every 5 minutes, keeping last 1000 events ---
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const PRUNE_KEEP_COUNT = 1000;
const pruneTimer = setInterval(() => {
  try {
    const currentSeq = globalEventBus.currentSeq;
    if (currentSeq > PRUNE_KEEP_COUNT) {
      const pruned = replayLog.prune(currentSeq - PRUNE_KEEP_COUNT);
      if (pruned > 0) {
        console.log(`[server] Pruned ${pruned} old event log entries`);
      }
    }
  } catch (err) {
    console.error('[server] Failed to prune event log:', err);
  }
}, PRUNE_INTERVAL_MS);

// Graceful shutdown
const shutdown = () => {
  console.log('[server] Shutting down...');
  clearInterval(pruneTimer);
  // Flush any remaining buffered events before closing DB
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  flushEventBuffer();
  // Dispose all workspaces (kills processes, closes watchers)
  workspaceManager[Symbol.dispose]();
  // Close database
  closeDatabase();
  server.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- 8. Restore persisted workspaces and sessions in background ---
(async () => {
  try {
    await workspaceManager.restore();
    // Restore sessions for each workspace and attach sessionManager
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

/**
 * Server entry point -- bootstrap Hono server on dynamic port.
 */

import { createApp } from './app.js';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from '@coding-assistant/shared';

// Read config from environment (injected by Tauri sidecar)
const port = parseInt(process.env.PORT ?? String(DEFAULT_SERVER_PORT), 10);
const host = process.env.HOST ?? DEFAULT_SERVER_HOST;
const authSecret = process.env.AUTH_SECRET ?? crypto.randomUUID();

const app = createApp(authSecret);

console.log(`[server] Starting on ${host}:${port}`);
console.log(`[server] Auth secret: ${authSecret.slice(0, 8)}...`);

// Bun native serve
const server = Bun.serve({
  fetch: app.fetch,
  port,
  hostname: host,
});

console.log(`[server] Listening on http://${server.hostname}:${server.port}`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[server] Shutting down...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[server] Shutting down...');
  server.stop();
  process.exit(0);
});

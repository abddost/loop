/**
 * Hono app factory -- creates the application with all routes and middleware.
 */

import { Hono } from 'hono';
import { authMiddleware } from './middleware/auth.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { workspacesRouter } from './routes/workspaces.js';
import { sessionsRouter } from './routes/sessions.js';
import { messagesRouter } from './routes/messages.js';
import { eventsRouter } from './routes/events.js';
import { permissionsRouter } from './routes/permissions.js';
import { configRouter } from './routes/config.js';
import { modelsRouter } from './routes/models.js';
import { providersRouter } from './routes/providers.js';

export type AppEnv = {
  Variables: {
    requestId: string;
    authSecret: string;
  };
};

export function createApp(authSecret: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Global middleware
  app.use('*', requestIdMiddleware());
  app.use('*', corsMiddleware());
  app.use('/api/*', authMiddleware(authSecret));
  app.onError(errorHandler);

  // Health check (no auth)
  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // API routes
  app.route('/api/workspaces', workspacesRouter);
  app.route('/api/sessions', sessionsRouter);
  app.route('/api/messages', messagesRouter);
  app.route('/api/events', eventsRouter);
  app.route('/api/permissions', permissionsRouter);
  app.route('/api/config', configRouter);
  app.route('/api/models', modelsRouter);
  app.route('/api/providers', providersRouter);

  return app;
}

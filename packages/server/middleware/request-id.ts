/**
 * Request ID middleware -- generates unique IDs for each request.
 */

import { createMiddleware } from 'hono/factory';
import { generateRequestId } from '@coding-assistant/shared';
import type { AppEnv } from '../app.js';

export function requestIdMiddleware() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = c.req.header('X-Request-ID') ?? generateRequestId();
    c.set('requestId', requestId);
    c.header('X-Request-ID', requestId);
    return next();
  });
}

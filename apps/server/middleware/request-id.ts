/**
 * Request ID middleware -- generates unique IDs for each request.
 */

import { createMiddleware } from 'hono/factory';
import { generateRequestId } from '@coding-assistant/shared';

export function requestIdMiddleware() {
  return createMiddleware(async (c, next) => {
    const requestId = c.req.header('X-Request-ID') ?? generateRequestId();
    c.set('requestId' as never, requestId as never);
    c.header('X-Request-ID', requestId);
    return next();
  });
}

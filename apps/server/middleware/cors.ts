/**
 * CORS middleware for local development.
 */

import { createMiddleware } from 'hono/factory';

export function corsMiddleware() {
  return createMiddleware(async (c, next) => {
    // Only allow localhost origins (desktop app)
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    c.header('Access-Control-Allow-Credentials', 'true');

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }

    return next();
  });
}

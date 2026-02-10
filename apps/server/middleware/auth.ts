/**
 * Auth middleware -- validates the auth secret from the Tauri sidecar.
 */

import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../app.js';

export function authMiddleware(secret: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    // Check Authorization header
    const auth = c.req.header('Authorization');
    if (auth) {
      const token = auth.replace('Bearer ', '');
      if (token === secret) {
        c.set('authSecret', secret);
        return next();
      }
    }

    // Check cookie
    const cookie = c.req.header('Cookie');
    if (cookie?.includes(`auth=${secret}`)) {
      c.set('authSecret', secret);
      return next();
    }

    // For SSE connections, check query param
    const url = new URL(c.req.url);
    const queryToken = url.searchParams.get('token');
    if (queryToken === secret) {
      c.set('authSecret', secret);
      return next();
    }

    return c.json({ error: 'Unauthorized' }, 401);
  });
}

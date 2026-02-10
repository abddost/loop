/**
 * Permission routes -- POST permission responses from the UI.
 */

import { Hono } from 'hono';
import type { PermissionResponse } from '@coding-assistant/shared';
import { globalEventBus } from '@coding-assistant/core';

// Pending permission requests waiting for responses
const pendingRequests = new Map<string, {
  resolve: (granted: boolean) => void;
  workspaceId: string;
  sessionId: string;
}>();

/**
 * Register a pending permission request.
 * Returns a promise that resolves when the user responds.
 */
export function registerPermissionRequest(
  requestId: string,
  workspaceId: string,
  sessionId: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    pendingRequests.set(requestId, { resolve, workspaceId, sessionId });

    // Auto-timeout after 5 minutes
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        resolve(false);
      }
    }, 5 * 60 * 1000);
  });
}

export const permissionsRouter = new Hono()
  // Submit a permission response
  .post('/respond', async (c) => {
    const body = await c.req.json<PermissionResponse>();

    const pending = pendingRequests.get(body.requestId);
    if (!pending) {
      return c.json({ error: 'Permission request not found or expired' }, 404);
    }

    // Resolve the pending promise
    pending.resolve(body.granted);
    pendingRequests.delete(body.requestId);

    // Emit response event
    globalEventBus.emit({
      type: 'permission-response',
      workspaceId: pending.workspaceId,
      sessionId: pending.sessionId,
      timestamp: new Date().toISOString(),
      requestId: body.requestId,
      granted: body.granted,
    });

    return c.json({ success: true });
  })

  // List pending permission requests
  .get('/pending', (c) => {
    const requests = Array.from(pendingRequests.entries()).map(([id, req]) => ({
      requestId: id,
      workspaceId: req.workspaceId,
      sessionId: req.sessionId,
    }));
    return c.json({ requests });
  });

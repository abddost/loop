/**
 * Permission routes -- POST permission responses from the UI.
 */

import { Hono } from 'hono';
import { NotFoundError } from '@coding-assistant/shared';
import { globalEventBus } from '@coding-assistant/core';
import type { PermissionResponseEvent } from '@coding-assistant/shared';
import { getPermissionRequestStore } from '../services.js';
import { parseBody, permissionResponseSchema } from '../schemas/index.js';

/**
 * Register a pending permission request.
 *
 * Exported so the execution layer can call it when a tool needs approval.
 * Delegates to the PermissionRequestStore singleton.
 */
import type { PermissionResult } from '../services/permission-requests.js';

export function registerPermissionRequest(
  requestId: string,
  workspaceId: string,
  sessionId: string,
): Promise<PermissionResult> {
  return getPermissionRequestStore().register(requestId, workspaceId, sessionId);
}

export const permissionsRouter = new Hono()
  // Submit a permission response
  .post('/respond', async (c) => {
    const body = await parseBody(c, permissionResponseSchema);

    const entry = getPermissionRequestStore().respond(
      body.requestId,
      body.granted,
      body.mode,
      body.feedback,
    );
    if (!entry) {
      throw new NotFoundError('Permission request', body.requestId);
    }

    globalEventBus.emit({
      type: 'permission-response',
      workspaceId: entry.workspaceId,
      sessionId: entry.sessionId,
      timestamp: new Date().toISOString(),
      requestId: body.requestId,
      granted: body.granted,
      mode: body.mode,
      feedback: body.feedback,
    } as PermissionResponseEvent);

    return c.json({ success: true });
  })

  // List pending permission requests
  .get('/pending', (c) => {
    const requests = getPermissionRequestStore().listPending();
    return c.json({ requests });
  });

/**
 * Session routes -- CRUD sessions within a workspace.
 */

import { Hono } from 'hono';
import { getSessionManager } from '../services.js';
import { resolveWorkspace, resolveSession } from '../helpers/resolve.js';
import { parseBody, createSessionSchema } from '../schemas/index.js';

export const sessionsRouter = new Hono()
  // List sessions for a workspace
  .get('/', (c) => {
    const workspace = resolveWorkspace(c.req.query('workspaceId'));
    const sessionManager = getSessionManager();

    const sessions = sessionManager.list(workspace).map((s) => ({
      id: s.id,
      workspaceId: workspace.id,
      title: s.title ?? undefined,
      agentId: s.agentId,
      status: s.state.status,
      messageCount: s.timeline.length,
      createdAt: s.createdAt,
    }));

    return c.json({ sessions });
  })

  // Create a new session
  .post('/', async (c) => {
    const body = await parseBody(c, createSessionSchema);
    const workspace = resolveWorkspace(body.workspaceId);
    const sessionManager = getSessionManager();

    const session = sessionManager.create(workspace, body.agentId);

    return c.json({
      session: {
        id: session.id,
        workspaceId: workspace.id,
        agentId: session.agentId,
        status: session.state.status,
        createdAt: session.createdAt,
      },
    }, 201);
  })

  // Get session details
  .get('/:id', (c) => {
    const { workspace, session } = resolveSession(
      c.req.query('workspaceId'),
      c.req.param('id'),
    );

    return c.json({
      session: {
        id: session.id,
        workspaceId: workspace.id,
        agentId: session.agentId,
        status: session.state.status,
        messages: session.timeline.toUIMessages(),
        createdAt: session.createdAt,
      },
    });
  })

  // Delete/close a session
  .delete('/:id', (c) => {
    const workspace = resolveWorkspace(c.req.query('workspaceId'));
    const sessionManager = getSessionManager();

    sessionManager.close(workspace, c.req.param('id'));
    return c.json({ success: true });
  })

  // Cancel active execution
  .post('/:id/cancel', (c) => {
    const { session } = resolveSession(
      c.req.query('workspaceId'),
      c.req.param('id'),
    );

    session.cancel();
    return c.json({ success: true, status: 'cancelling' });
  });

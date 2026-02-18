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

    const sessionList = sessionManager.list(workspace);

    const sessions = sessionList.map((s) => ({
      id: s.id,
      workspaceId: workspace.id,
      title: s.title ?? undefined,
      agentId: s.agentId,
      status: s.state.status,
      messageCount: s.messageCount,
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

  // Get session details (supports optional message pagination)
  .get('/:id', (c) => {
    const { workspace, session } = resolveSession(
      c.req.query('workspaceId'),
      c.req.param('id'),
    );

    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');

    // Without pagination params, return all messages (backward compatible)
    if (limitParam == null && offsetParam == null) {
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
    }

    const limit = Math.max(1, Number(limitParam) || 50);
    const offset = Math.max(0, Number(offsetParam) || 0);
    const { messages, total } = session.timeline.toUIMessagesPaginated(offset, limit);

    return c.json({
      session: {
        id: session.id,
        workspaceId: workspace.id,
        agentId: session.agentId,
        status: session.state.status,
        messages,
        createdAt: session.createdAt,
      },
      pagination: {
        total,
        hasMore: offset + limit < total,
        limit,
        offset,
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

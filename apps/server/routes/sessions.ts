/**
 * Session routes -- CRUD sessions within a workspace.
 */

import { Hono } from 'hono';
import { SessionManager } from '@coding-assistant/core';
import { workspaceManager } from './workspaces.js';

const sessionManager = new SessionManager();

export { sessionManager };

export const sessionsRouter = new Hono()
  // List sessions for a workspace
  .get('/', (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: 'workspaceId query param is required' }, 400);
    }

    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const sessions = sessionManager.list(workspace).map((s) => ({
      id: s.id,
      workspaceId: workspace.id,
      agentId: s.agentId,
      status: s.state.status,
      messageCount: s.timeline.length,
      createdAt: s.createdAt,
    }));

    return c.json({ sessions });
  })

  // Create a new session
  .post('/', async (c) => {
    const body = await c.req.json<{ workspaceId: string; agentId?: string }>();

    const workspace = workspaceManager.get(body.workspaceId);
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

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
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: 'workspaceId query param is required' }, 400);
    }

    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const session = sessionManager.get(workspace, c.req.param('id'));
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

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
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: 'workspaceId query param is required' }, 400);
    }

    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    sessionManager.close(workspace, c.req.param('id'));
    return c.json({ success: true });
  })

  // Cancel active execution
  .post('/:id/cancel', (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: 'workspaceId query param is required' }, 400);
    }

    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const session = sessionManager.get(workspace, c.req.param('id'));
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    session.cancel();
    return c.json({ success: true, status: 'cancelling' });
  });

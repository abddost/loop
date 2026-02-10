/**
 * Workspace routes -- open/close/list workspaces.
 */

import { Hono } from 'hono';
import { WorkspaceManager } from '@coding-assistant/core';

const workspaceManager = new WorkspaceManager();

export { workspaceManager };

export const workspacesRouter = new Hono()
  // List open workspaces
  .get('/', (c) => {
    const workspaces = workspaceManager.list().map((ws) => ({
      id: ws.id,
      name: ws.name,
      rootPath: ws.rootPath,
      sessionCount: ws.sessions.size,
      createdAt: ws.createdAt,
    }));
    return c.json({ workspaces });
  })

  // Open a workspace
  .post('/', async (c) => {
    const body = await c.req.json<{ rootPath: string }>();
    if (!body.rootPath) {
      return c.json({ error: 'rootPath is required' }, 400);
    }

    const workspace = await workspaceManager.open(body.rootPath);
    return c.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        rootPath: workspace.rootPath,
        gitState: workspace.gitState,
        createdAt: workspace.createdAt,
      },
    }, 201);
  })

  // Get workspace details
  .get('/:id', (c) => {
    const workspace = workspaceManager.get(c.req.param('id'));
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    return c.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        rootPath: workspace.rootPath,
        gitState: workspace.gitState,
        sessionCount: workspace.sessions.size,
        sessions: Array.from(workspace.sessions.values()).map((s) => ({
          id: s.id,
          agentId: s.agentId,
          status: s.state.status,
          createdAt: s.createdAt,
        })),
        createdAt: workspace.createdAt,
      },
    });
  })

  // Close a workspace
  .delete('/:id', async (c) => {
    await workspaceManager.close(c.req.param('id'));
    return c.json({ success: true });
  });

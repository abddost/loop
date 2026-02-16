/**
 * Workspace routes -- open/close/list workspaces.
 */

import { Hono } from 'hono';
import { getWorkspaceManager, getSessionManager } from '../services.js';
import { resolveWorkspace } from '../helpers/resolve.js';
import { parseBody, openWorkspaceSchema } from '../schemas/index.js';

export const workspacesRouter = new Hono()
  // List open workspaces
  .get('/', (c) => {
    const workspaceManager = getWorkspaceManager();
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
    const workspaceManager = getWorkspaceManager();
    const body = await parseBody(c, openWorkspaceSchema);

    const workspace = await workspaceManager.open(body.rootPath);
    workspace.sessionManager = getSessionManager();
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
    const workspace = resolveWorkspace(c.req.param('id'));

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
    const workspaceManager = getWorkspaceManager();
    await workspaceManager.close(c.req.param('id'));
    return c.json({ success: true });
  });

/**
 * Workspace routes -- open/close/list workspaces.
 */

import { Hono } from 'hono';
import { detectGitState } from '@coding-assistant/core';
import { getWorkspaceManager, getSessionManager } from '../services.js';
import { resolveWorkspace } from '../helpers/resolve.js';
import { parseBody, openWorkspaceSchema } from '../schemas/index.js';

export const workspacesRouter = new Hono()
  // List open workspaces (gitState re-detected on each request for fresh branch info)
  .get('/', async (c) => {
    const workspaceManager = getWorkspaceManager();
    const list = workspaceManager.list();
    const workspaces = await Promise.all(
      list.map(async (ws) => {
        const gitState = await detectGitState(ws.rootPath);
        return {
          id: ws.id,
          name: ws.name,
          rootPath: ws.rootPath,
          sessionCount: ws.sessions.size,
          createdAt: ws.createdAt,
          gitState,
        };
      }),
    );
    for (const w of workspaces) {
      if (!w.gitState?.branch) {
        console.log('[workspaces] no branch:', w.name, '| rootPath:', w.rootPath);
      }
    }
    c.header('Cache-Control', 'no-store');
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

/**
 * Config routes -- read/update workspace configuration.
 */

import { Hono } from 'hono';
import { workspaceManager } from './workspaces.js';

export const configRouter = new Hono()
  // Get workspace config
  .get('/:workspaceId', (c) => {
    const workspace = workspaceManager.get(c.req.param('workspaceId'));
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    return c.json({ config: workspace.config });
  })

  // Update workspace config
  .put('/:workspaceId', async (c) => {
    const workspace = workspaceManager.get(c.req.param('workspaceId'));
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const body = await c.req.json<Record<string, unknown>>();

    // Merge with existing config
    workspace.config = { ...workspace.config, ...body } as typeof workspace.config;

    return c.json({ config: workspace.config });
  });

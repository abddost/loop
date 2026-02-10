/**
 * Config routes -- read/update workspace configuration.
 */

import { Hono } from 'hono';
import { resolveWorkspace } from '../helpers/resolve.js';

export const configRouter = new Hono()
  // Get workspace config
  .get('/:workspaceId', (c) => {
    const workspace = resolveWorkspace(c.req.param('workspaceId'));
    return c.json({ config: workspace.config });
  })

  // Update workspace config
  .put('/:workspaceId', async (c) => {
    const workspace = resolveWorkspace(c.req.param('workspaceId'));
    const body = await c.req.json<Record<string, unknown>>();

    // Merge with existing config
    workspace.config = { ...workspace.config, ...body } as typeof workspace.config;

    return c.json({ config: workspace.config });
  });

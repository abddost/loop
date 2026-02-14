/**
 * Agent routes -- list available user-facing agents.
 */

import { Hono } from 'hono';
import { agentRegistry } from '@coding-assistant/core';

/** Internal agents not exposed to the frontend. */
const INTERNAL_AGENTS = new Set(['summarize', 'title']);

export const agentsRouter = new Hono()
  .get('/', (c) => {
    const all = agentRegistry.list();
    const agents = all
      .filter((a) => !INTERNAL_AGENTS.has(a.id))
      .map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        capabilities: {
          canWrite: a.toolPolicy.allowed.includes('file-write'),
          canShell: a.toolPolicy.allowed.includes('shell'),
          canWeb: a.toolPolicy.allowed.includes('web'),
          maxSteps: a.maxSteps,
        },
      }));

    return c.json({ agents });
  });

/**
 * Message routes -- POST new user message to trigger execution.
 */

import { Hono } from 'hono';
import { executeStream } from '@coding-assistant/core';
import { workspaceManager } from './workspaces.js';
import { sessionManager } from './sessions.js';

export const messagesRouter = new Hono()
  // Send a message and trigger execution
  .post('/', async (c) => {
    const body = await c.req.json<{
      workspaceId: string;
      sessionId: string;
      content: string;
    }>();

    const workspace = workspaceManager.get(body.workspaceId);
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const session = sessionManager.get(workspace, body.sessionId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    if (session.state.status !== 'idle') {
      return c.json({ error: 'Session is busy' }, 409);
    }

    // Add user message to timeline
    session.timeline.appendMessage({
      role: 'user',
      parts: [{
        type: 'text',
        id: `part_${Date.now()}`,
        index: 0,
        text: body.content,
      }],
    });

    // Start execution (fire and forget -- events stream via SSE)
    (async () => {
      try {
        for await (const _event of executeStream(workspace, session, {
          content: body.content,
        })) {
          // Events are emitted to the global bus by executeStream
          // The SSE endpoint picks them up from there
        }
      } catch (error) {
        console.error('Execution error:', error);
      }
    })();

    return c.json({ status: 'started', sessionId: session.id });
  })

  // Get messages for a session
  .get('/', (c) => {
    const workspaceId = c.req.query('workspaceId');
    const sessionId = c.req.query('sessionId');

    if (!workspaceId || !sessionId) {
      return c.json({ error: 'workspaceId and sessionId are required' }, 400);
    }

    const workspace = workspaceManager.get(workspaceId);
    if (!workspace) {
      return c.json({ error: 'Workspace not found' }, 404);
    }

    const session = sessionManager.get(workspace, sessionId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({
      messages: session.timeline.toUIMessages(),
    });
  });

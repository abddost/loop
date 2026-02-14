/**
 * Message routes -- POST new user message to trigger execution.
 */

import { Hono } from 'hono';
import {
  executeStream,
  globalEventBus,
  mapMessageStart,
  mapTextDone,
  generateSessionTitle,
  needsTitle,
} from '@coding-assistant/core';
import { ConflictError } from '@coding-assistant/shared';
import { resolveSession } from '../helpers/resolve.js';
import { getSessionManager } from '../services.js';
import { parseBody, sendMessageSchema } from '../schemas/index.js';

export const messagesRouter = new Hono()
  // Send a message and trigger execution
  .post('/', async (c) => {
    const body = await parseBody(c, sendMessageSchema);
    const { workspace, session } = resolveSession(body.workspaceId, body.sessionId);

    if (session.state.status !== 'idle') {
      throw new ConflictError('Session is busy');
    }

    // Switch agent if requested and different from current
    if (body.agentId && body.agentId !== session.agentId) {
      session.switchAgent(body.agentId);
    }

    // Add user message to timeline (use client-provided messageId for optimistic dedup)
    const userMsg = session.timeline.appendMessage({
      id: body.messageId,
      role: 'user',
      parts: [{
        type: 'text',
        id: `part_${Date.now()}`,
        index: 0,
        text: body.content,
      }],
    });

    // Emit user message events so the frontend sees them via SSE
    const scope = { workspaceId: workspace.id, sessionId: session.id, messageId: userMsg.id };
    globalEventBus.emit(mapMessageStart(scope, 'user'));
    globalEventBus.emit(mapTextDone(scope, body.content));

    // Start execution (fire and forget -- events stream via SSE)
    (async () => {
      try {
        for await (const _event of executeStream(workspace, session, {
          content: body.content,
          model: body.model,
          effort: body.effort,
        })) {
          // Events are emitted to the global bus by executeStream
          // The SSE endpoint picks them up from there
        }

        // Auto-generate session title after execution completes
        if (needsTitle(session.title, session.timeline.messages)) {
          const title = generateSessionTitle(session.timeline.messages);
          const sessionManager = getSessionManager();
          sessionManager.updateTitle(workspace, session.id, title);
        }
      } catch (error) {
        console.error('Execution error:', error);
        // Recover session state so it's not permanently stuck in busy
        if (session.state.status !== 'idle') {
          try { session.state.transition('idle'); } catch { /* already idle */ }
        }
      }
    })();

    return c.json({ status: 'started', sessionId: session.id });
  })

  // Get messages for a session
  .get('/', (c) => {
    const { session } = resolveSession(
      c.req.query('workspaceId'),
      c.req.query('sessionId'),
    );

    return c.json({
      messages: session.timeline.toUIMessages(),
    });
  });

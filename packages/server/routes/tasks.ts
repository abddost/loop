/**
 * Task routes -- CRUD for session-scoped tasks.
 */

import { Hono } from 'hono';
import { readTasksForSession, updateTasksForSession, deleteTaskForSession } from '@coding-assistant/core';

export const tasksRouter = new Hono()

  /**
   * GET /api/tasks?workspaceId=...&sessionId=...
   * Returns tasks for a session's bound task list (empty if unbound).
   */
  .get('/', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    const sessionId = c.req.query('sessionId');
    if (!workspaceId) {
      return c.json({ error: { message: 'workspaceId query parameter is required' } }, 400);
    }
    if (!sessionId) {
      return c.json({ error: { message: 'sessionId query parameter is required' } }, 400);
    }

    const { tasks, version } = await readTasksForSession(workspaceId, sessionId);
    return c.json({ tasks, version });
  })

  /**
   * POST /api/tasks
   * Create or update tasks scoped to a session's task list.
   * Body: { workspaceId: string, sessionId: string, tasks: TaskItem[] }
   */
  .post('/', async (c) => {
    const body = await c.req.json();
    const { workspaceId, sessionId, tasks } = body;

    if (!workspaceId || !sessionId || !Array.isArray(tasks)) {
      return c.json({ error: { message: 'workspaceId, sessionId, and tasks array are required' } }, 400);
    }

    const result = await updateTasksForSession(workspaceId, sessionId, tasks);

    return c.json({
      created: result.createdCount,
      updated: result.updatedCount,
      total: result.tasks.length,
      version: result.version,
    });
  })

  /**
   * DELETE /api/tasks/:taskId?workspaceId=...&sessionId=...
   * Delete a specific task from a session's task list.
   */
  .delete('/:taskId', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    const sessionId = c.req.query('sessionId');
    const taskId = c.req.param('taskId');

    if (!workspaceId) {
      return c.json({ error: { message: 'workspaceId query parameter is required' } }, 400);
    }
    if (!sessionId) {
      return c.json({ error: { message: 'sessionId query parameter is required' } }, 400);
    }

    const result = await deleteTaskForSession(workspaceId, sessionId, taskId);
    return c.json({ success: true, total: result.tasks.length, version: result.version });
  });

/**
 * Task routes -- CRUD for persistent workspace-scoped tasks.
 */

import { Hono } from 'hono';
import { readTaskList, updateTaskList, deleteTask } from '@coding-assistant/core';

export const tasksRouter = new Hono()

  /**
   * GET /api/tasks?workspaceId=...
   * Returns all tasks for a workspace.
   */
  .get('/', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { message: 'workspaceId query parameter is required' } }, 400);
    }

    const taskList = await readTaskList(workspaceId);
    return c.json({ tasks: taskList.tasks, version: taskList.version });
  })

  /**
   * POST /api/tasks
   * Create or update tasks.
   * Body: { workspaceId: string, tasks: TaskItem[] }
   */
  .post('/', async (c) => {
    const body = await c.req.json();
    const { workspaceId, tasks } = body;

    if (!workspaceId || !Array.isArray(tasks)) {
      return c.json({ error: { message: 'workspaceId and tasks array are required' } }, 400);
    }

    const result = await updateTaskList(workspaceId, tasks);

    const created = tasks.filter((t: { id?: string }) => !t.id).length;
    const updated = tasks.filter((t: { id?: string }) => t.id).length;

    return c.json({ created, updated, total: result.tasks.length, version: result.version });
  })

  /**
   * DELETE /api/tasks/:taskId?workspaceId=...
   * Delete a specific task.
   */
  .delete('/:taskId', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    const taskId = c.req.param('taskId');

    if (!workspaceId) {
      return c.json({ error: { message: 'workspaceId query parameter is required' } }, 400);
    }

    const result = await deleteTask(workspaceId, taskId);
    return c.json({ success: true, total: result.tasks.length, version: result.version });
  });

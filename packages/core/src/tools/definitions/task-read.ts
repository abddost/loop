/**
 * task-read tool -- reads the session-scoped task list.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  taskId: z.string().optional().describe('Optional task ID to read a specific task'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, unknown> = {
  name: 'task-read',
  description: 'Read the task list for this session. Optionally pass a taskId to read a specific task.',
  inputSchema,
  category: 'task',
  riskLevel: 'safe',

  async execute(input, ctx) {
    const { readTasksForSession } = await import('../../workspace/task-store.js');

    const { tasks, version } = await readTasksForSession(ctx.workspaceId, ctx.sessionId);

    if (input.taskId) {
      const task = tasks.find((t) => t.id === input.taskId);
      if (!task) {
        return {
          result: { error: `Task "${input.taskId}" not found` },
          metadata: { count: 0 },
        };
      }
      return {
        result: task,
        metadata: { count: 1 },
      };
    }

    return {
      result: { tasks, version },
      metadata: { count: tasks.length },
    };
  },
};

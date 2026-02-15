/**
 * task-read tool -- reads the persistent task list for a workspace.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  taskId: z.string().optional().describe('Optional task ID to read a specific task'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, unknown> = {
  name: 'task-read',
  description: 'Read the task list for this workspace. Optionally pass a taskId to read a specific task.',
  inputSchema,
  category: 'task',
  riskLevel: 'safe',

  async execute(input, ctx) {
    const { readTaskList } = await import('../../workspace/task-store.js');

    const taskList = await readTaskList(ctx.workspaceId);

    if (input.taskId) {
      const task = taskList.tasks.find((t) => t.id === input.taskId);
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
      result: { tasks: taskList.tasks, version: taskList.version },
      metadata: { count: taskList.tasks.length },
    };
  },
};

/**
 * task-write tool -- creates or updates tasks in the session-scoped task list.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const taskItemSchema = z.object({
  id: z.string().optional().describe('Task ID -- omit to create a new task, include to update existing'),
  subject: z.string().describe('Brief task title in imperative form'),
  description: z.string().optional().default('').describe('Detailed description of what needs to be done'),
  activeForm: z.string().optional().default('').describe('Present continuous form for spinner display (e.g. "Running tests")'),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional().default('pending'),
  blocks: z.array(z.string()).optional().default([]).describe('IDs of tasks this one blocks'),
  blockedBy: z.array(z.string()).optional().default([]).describe('IDs of tasks blocking this one'),
});

const inputSchema = z.object({
  tasks: z.array(taskItemSchema).describe('Tasks to create or update'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'task-write',
  description: 'Create or update tasks in the session task list. Omit id to create new tasks, include id to update existing ones. Tasks are scoped to the current session.',
  inputSchema,
  category: 'task',
  riskLevel: 'safe',

  async execute(input, ctx) {
    const { updateTasksForSession } = await import('../../workspace/task-store.js');

    const result = await updateTasksForSession(ctx.workspaceId, ctx.sessionId, input.tasks);

    const parts: string[] = [];
    if (result.createdCount > 0) parts.push(`${result.createdCount} created`);
    if (result.updatedCount > 0) parts.push(`${result.updatedCount} updated`);

    return {
      result: `Tasks: ${parts.join(', ')}. Total: ${result.tasks.length} tasks.`,
      metadata: {
        created: result.createdCount,
        updated: result.updatedCount,
        total: result.tasks.length,
        version: result.version,
        taskListId: result.taskListId,
      },
    };
  },
};

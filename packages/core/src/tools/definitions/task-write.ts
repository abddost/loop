/**
 * task-write tool -- creates or updates tasks in the persistent workspace task list.
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
  description: 'Create or update tasks in the workspace task list. Omit id to create new tasks, include id to update existing ones. Tasks persist across sessions.',
  inputSchema,
  category: 'task',
  riskLevel: 'safe',

  async execute(input, ctx) {
    const { updateTaskList } = await import('../../workspace/task-store.js');

    const result = await updateTaskList(ctx.workspaceId, input.tasks);

    const created = input.tasks.filter((t) => !t.id).length;
    const updated = input.tasks.filter((t) => t.id).length;

    const parts: string[] = [];
    if (created > 0) parts.push(`${created} created`);
    if (updated > 0) parts.push(`${updated} updated`);

    return {
      result: `Tasks: ${parts.join(', ')}. Total: ${result.tasks.length} tasks.`,
      metadata: {
        created,
        updated,
        total: result.tasks.length,
        version: result.version,
      },
    };
  },
};

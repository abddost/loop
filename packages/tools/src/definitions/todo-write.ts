/**
 * todo-write tool -- creates or updates the task list.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { getTodos, setTodos } from './todo-read.js';

const todoItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

const inputSchema = z.object({
  todos: z.array(todoItemSchema).describe('The todo items to set'),
  merge: z.boolean().optional().default(false).describe('Whether to merge with existing todos'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'todo-write',
  description: 'Create or update the task list for this session',
  inputSchema,
  category: 'task',
  riskLevel: 'safe',

  async execute(input, ctx) {
    if (input.merge) {
      const existing = getTodos(ctx.sessionId);
      const merged = [...existing];

      for (const newItem of input.todos) {
        const idx = merged.findIndex((e) => e.id === newItem.id);
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], ...newItem };
        } else {
          merged.push(newItem);
        }
      }

      setTodos(ctx.sessionId, merged);
      return { result: `Updated ${input.todos.length} todos (merged)` };
    }

    setTodos(ctx.sessionId, input.todos);
    return { result: `Set ${input.todos.length} todos` };
  },
};

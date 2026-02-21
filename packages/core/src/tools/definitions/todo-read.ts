/**
 * todo-read tool -- reads the current task list.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({});

type Input = z.infer<typeof inputSchema>;

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

// In-memory todo storage (per-session in production)
const todos = new Map<string, TodoItem[]>();

export function getTodos(sessionId: string): TodoItem[] {
  return todos.get(sessionId) ?? [];
}

export function setTodos(sessionId: string, items: TodoItem[]): void {
  todos.set(sessionId, items);
}

export const definition: ToolDefinition<Input, TodoItem[]> = {
  name: 'todo-read',
  description: 'Read the current task list for this session',
  inputSchema,
  category: 'task',
  riskLevel: 'safe',

  async execute(_input, ctx) {
    await ctx.ask({
      permission: 'todoread',
      patterns: ['*'],
      always: ['*'],
      metadata: { toolName: 'todo-read' },
    });

    const items = getTodos(ctx.sessionId);
    return {
      result: items,
      metadata: { count: items.length },
    };
  },
};

/**
 * TodoCard -- card for todo-read and todo-write tool calls.
 * Shows a checklist of tasks with completion status.
 */

import { memo } from 'react';
import { Check } from '@openai/apps-sdk-ui/components/Icon';
import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import type { ToolCallPart, ToolResultPart } from '../../types';

interface TodoCardProps {
  part: ToolCallPart;
  isRunning: boolean;
  isError: boolean;
  result?: ToolResultPart;
}

interface TodoItem {
  id?: string;
  title?: string;
  text?: string;
  status?: string;
  completed?: boolean;
}

function parseTodos(data: unknown): TodoItem[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'todos' in data && Array.isArray((data as Record<string, unknown>).todos)) {
    return (data as Record<string, unknown>).todos as TodoItem[];
  }
  return [];
}

export const TodoCard = memo(function TodoCard({ part, isRunning, isError, result }: TodoCardProps) {
  const isWrite = part.toolName === 'todo-write';

  // For write operations, get todos from args; for read, from result
  const todos = isWrite
    ? parseTodos(part.args?.todos)
    : parseTodos(result?.result);

  if (isRunning) {
    return (
      <div className="py-0.5 flex items-center gap-1.5">
        <ShimmerableText shimmer className="text-sm text-tertiary">
          {isWrite ? 'Writing tasks...' : 'Reading tasks...'}
        </ShimmerableText>
      </div>
    );
  }

  if (todos.length === 0) {
    return (
      <div className="py-0.5 text-sm text-tertiary">
        {isWrite ? 'Updated task list' : 'No tasks found'}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-default bg-surface overflow-hidden px-4 py-2.5">
      <div className="text-xs font-medium text-secondary mb-2">
        {isWrite ? `${todos.length} tasks` : 'Task list'}
      </div>
      <div className="space-y-1">
        {todos.map((todo, i) => {
          const done = todo.completed || todo.status === 'completed' || todo.status === 'done';
          const label = todo.title || todo.text || `Task ${i + 1}`;
          return (
            <div key={todo.id ?? i} className="flex items-center gap-2 text-xs">
              {done ? (
                <div className="size-3.5 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                  <Check className="size-2.5 text-green-500" />
                </div>
              ) : (
                <div className="size-3.5 rounded-full border border-default shrink-0" />
              )}
              <span className={done ? 'text-tertiary line-through' : 'text-secondary'}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

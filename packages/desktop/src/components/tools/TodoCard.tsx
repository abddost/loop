/**
 * TaskCard -- card for task-read, task-write, todo-read, and todo-write tool calls.
 *
 * Shows a checklist of tasks with completion status, dependency badges,
 * and expandable descriptions. Backward compatible with old todo format.
 */

import { memo, useState } from 'react';
import { ChevronDown, ChevronRight } from '@openai/apps-sdk-ui/components/Icon';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import { StatusIndicator, ProgressBar } from '../tasks/TaskComponents';
import type { ToolCallPart, ToolResultPart } from '../../types';

interface TodoCardProps {
  part: ToolCallPart;
  isRunning: boolean;
  isError: boolean;
  result?: ToolResultPart;
}

interface TaskItemDisplay {
  id?: string;
  subject?: string;
  title?: string;
  text?: string;
  content?: string;
  description?: string;
  activeForm?: string;
  status?: string;
  completed?: boolean;
  blocks?: string[];
  blockedBy?: string[];
}

function parseTasks(data: unknown): TaskItemDisplay[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if ('tasks' in obj && Array.isArray(obj.tasks)) return obj.tasks as TaskItemDisplay[];
    if ('todos' in obj && Array.isArray(obj.todos)) return obj.todos as TaskItemDisplay[];
  }
  return [];
}

function getLabel(task: TaskItemDisplay, index: number): string {
  return task.subject || task.title || task.text || task.content || `Task ${index + 1}`;
}

function getStatus(task: TaskItemDisplay): 'pending' | 'in_progress' | 'completed' | 'cancelled' {
  if (task.completed || task.status === 'completed' || task.status === 'done') return 'completed';
  if (task.status === 'in_progress') return 'in_progress';
  if (task.status === 'cancelled') return 'cancelled';
  return 'pending';
}

function TaskRow({ task, index }: { task: TaskItemDisplay; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const status = getStatus(task);
  const label = getLabel(task, index);
  const hasDescription = !!task.description;
  const hasBlocks = task.blocks && task.blocks.length > 0;
  const hasBlockedBy = task.blockedBy && task.blockedBy.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 text-xs">
        <StatusIndicator status={status} />
        <span
          className={`flex-1 ${
            status === 'completed' ? 'text-tertiary line-through' :
            status === 'cancelled' ? 'text-tertiary line-through' :
            status === 'in_progress' ? 'text-default font-medium' :
            'text-secondary'
          }`}
        >
          {label}
        </span>
        {hasBlocks && (
          <Badge color="warning" variant="soft" size="sm">
            blocks {task.blocks!.length}
          </Badge>
        )}
        {hasBlockedBy && (
          <Badge color="danger" variant="soft" size="sm">
            blocked
          </Badge>
        )}
        {hasDescription && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-tertiary hover:text-secondary transition-colors p-0.5"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        )}
      </div>
      {expanded && task.description && (
        <div className="ml-5.5 mt-1 text-[10px] text-tertiary leading-relaxed whitespace-pre-wrap">
          {task.description}
        </div>
      )}
    </div>
  );
}

export const TodoCard = memo(function TodoCard({ part, isRunning, isError, result }: TodoCardProps) {
  const isWrite = part.toolName === 'todo-write' || part.toolName === 'task-write';

  // For write operations, get tasks from args; for read, from result
  const tasks = isWrite
    ? parseTasks(part.args?.tasks ?? part.args?.todos)
    : parseTasks(result?.output);

  if (isRunning) {
    return (
      <div className="py-0.5 flex items-center gap-1.5">
        <ShimmerableText shimmer className="text-sm text-tertiary">
          {isWrite ? 'Writing tasks...' : 'Reading tasks...'}
        </ShimmerableText>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="py-0.5 text-sm text-tertiary">
        {isWrite ? 'Updated task list' : 'No tasks found'}
      </div>
    );
  }

  const completedCount = tasks.filter((t) => getStatus(t) === 'completed').length;

  return (
    <div className="mt-2 rounded-xl border border-default bg-surface overflow-hidden px-4 py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs font-medium text-secondary">
          {isWrite ? `${tasks.length} tasks` : 'Task list'}
        </div>
        {tasks.length > 0 && (
          <div className="text-[10px] text-tertiary">
            {completedCount}/{tasks.length} done
          </div>
        )}
      </div>
      <ProgressBar completed={completedCount} total={tasks.length} />
      <div className="space-y-1.5 mt-2">
        {tasks.map((task, i) => (
          <TaskRow key={task.id ?? i} task={task} index={i} />
        ))}
      </div>
    </div>
  );
});

// Also export as TaskCard for new tool routing
export const TaskCard = TodoCard;

/**
 * TaskAccordionPanel -- compact task list that renders above ChatInput.
 *
 * Shows task progress with a pill badge and individual task statuses.
 * Uses Animate from @openai/apps-sdk-ui for smooth slide animation.
 */

import { memo } from 'react';
import { Animate } from '@openai/apps-sdk-ui/components/Transition';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { StatusIndicator } from '../tasks/TaskComponents';
import type { TaskItem } from '../../types';

interface TaskAccordionPanelProps {
  tasks: TaskItem[];
  loading: boolean;
  open: boolean;
}

function TaskRow({ task }: { task: TaskItem }) {
  const hasBlockedBy = task.blockedBy && task.blockedBy.length > 0;

  return (
    <div className="flex items-center gap-2 text-xs py-0.5">
      <StatusIndicator status={task.status} />
      <span
        className={`flex-1 truncate ${
          task.status === 'completed' ? 'text-tertiary line-through' :
          task.status === 'cancelled' ? 'text-tertiary line-through' :
          task.status === 'in_progress' ? 'text-default font-medium' :
          'text-secondary'
        }`}
      >
        {task.subject}
      </span>
      {hasBlockedBy && (
        <Tooltip content="Task is blocked by dependencies" compact gutterSize="sm" contentClassName="text-xs">
          <Badge color="danger" variant="soft" size="sm">
            blocked
          </Badge>
        </Tooltip>
      )}
    </div>
  );
}

export const TaskAccordionPanel = memo(function TaskAccordionPanel({
  tasks,
  loading,
  open,
}: TaskAccordionPanelProps) {
  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  return (
    <Animate
      as="div"
      enter={{ opacity: 1, duration: 150 }}
      initial={{ opacity: 0 }}
      transitionPosition="static"
    >
      {open && (
        <div key="task-panel" className="border-t border-subtle">
          <div className="max-w-3xl mx-auto px-4 py-2.5">
            {/* Header with pill badge */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-secondary">Tasks</span>
              <span className="text-[10px] text-tertiary bg-surface-secondary rounded-full px-1.5 py-0.5">
                {completedCount}/{tasks.length}
              </span>
            </div>

            {/* Task list */}
            {loading && tasks.length === 0 ? (
              <div className="text-xs text-tertiary py-2">Loading tasks...</div>
            ) : tasks.length === 0 ? (
              <div className="text-xs text-tertiary py-2">No tasks yet</div>
            ) : (
              <div className="mt-2 max-h-48 overflow-y-auto space-y-0.5">
                {tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Animate>
  );
});

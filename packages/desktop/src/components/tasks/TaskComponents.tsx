/**
 * Shared task UI components -- StatusIndicator.
 *
 * Used by both the inline TodoCard and the TaskAccordionPanel.
 */

import { Check } from '@openai/apps-sdk-ui/components/Icon';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/** Small right-arrow icon for in-progress tasks (replaces spinning indicator). */
function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.5 6H9.5M9.5 6L6.5 3M9.5 6L6.5 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="h-1 w-full rounded-full bg-surface-secondary overflow-hidden">
      <div
        className="h-full rounded-full bg-green-500 transition-all duration-300 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function StatusIndicator({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'completed':
      return (
        <div className="size-3.5 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
          <Check className="size-2.5 text-green-500" />
        </div>
      );
    case 'in_progress':
      return (
        <div className="size-3.5 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
          <ArrowRightIcon className="size-2.5 text-blue-500" />
        </div>
      );
    case 'cancelled':
      return (
        <div className="size-3.5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
          <span className="text-red-500 text-[8px] font-bold">&#x2715;</span>
        </div>
      );
    default:
      return <div className="size-3.5 rounded-full border border-default shrink-0" />;
  }
}

/**
 * TopBar -- minimal session header with sidebar toggle and title.
 */

import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { Sidebar } from '@openai/apps-sdk-ui/components/Icon';

interface TopBarProps {
  sessionTitle: string | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TopBar({ sessionTitle, sidebarOpen, onToggleSidebar }: TopBarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-subtle min-h-[48px] bg-surface">
      {/* Sidebar toggle -- always visible */}
      <Tooltip content={sidebarOpen ? 'Close sidebar' : 'Open sidebar'} compact gutterSize="sm" contentClassName="text-xs">
        <Button variant="ghost" color="secondary" size="sm" onClick={onToggleSidebar}>
          <Sidebar className="size-4" />
        </Button>
      </Tooltip>

      <div className="flex-1 flex items-center gap-2 min-w-0">
        {sessionTitle ? (
          <h1 className="text-sm font-medium text-default truncate">
            {sessionTitle}
          </h1>
        ) : (
          <span className="text-sm text-tertiary">No active session</span>
        )}
      </div>
    </div>
  );
}

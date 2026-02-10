/**
 * WorkspaceSwitcher -- legacy header component for switching between workspaces.
 * Functionality has been absorbed into SessionSidebar.
 * Kept for backwards compatibility.
 */

import { Button } from '@openai/apps-sdk-ui/components/Button';
import { FolderOpen } from '@openai/apps-sdk-ui/components/Icon';

interface WorkspaceInfo {
  id: string;
  name: string;
  rootPath: string;
  sessionCount: number;
}

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpen: () => void;
}

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  onSelect,
  onOpen,
}: WorkspaceSwitcherProps) {
  const active = workspaces.find((w) => w.id === activeId);

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-surface border-b border-subtle">
      <div className="text-xs font-bold text-tertiary tracking-wider">WORKSPACE</div>

      {active ? (
        <select
          value={activeId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          className="bg-surface border border-default rounded px-2 py-1 text-sm text-default focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name} ({ws.sessionCount} sessions)
            </option>
          ))}
        </select>
      ) : (
        <span className="text-sm text-tertiary italic">No workspace open</span>
      )}

      <Button
        variant="ghost"
        color="secondary"
        size="sm"
        onClick={onOpen}
        className="ml-auto"
      >
        <FolderOpen className="size-3.5" />
        Open Folder
      </Button>
    </div>
  );
}

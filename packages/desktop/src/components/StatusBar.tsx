/**
 * StatusBar -- bottom bar showing connection, active agent, and workspace info.
 */

import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { ShieldCheck, Desktop, FolderOpen } from '@openai/apps-sdk-ui/components/Icon';

interface StatusBarProps {
  connected: boolean;
  workspaceId: string | null;
  workspacePath?: string;
  activeAgent?: string;
  sessionStatus?: string;
}

export function StatusBar({ connected, workspaceId, workspacePath, activeAgent, sessionStatus }: StatusBarProps) {
  // Truncate workspace path to just the folder name
  const folderName = workspacePath
    ? workspacePath.split('/').filter(Boolean).pop() ?? workspacePath
    : null;

  return (
    <div className="flex items-center gap-1 px-3 py-1 border-t border-subtle text-[11px] bg-surface">
      {/* Connection / Local */}
      <Tooltip content={connected ? 'Connected to local server' : 'Disconnected'}>
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-secondary cursor-default">
          <Desktop className="size-3" />
          <span>Local</span>
          <div
            className={`size-1.5 rounded-full ${
              connected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
        </div>
      </Tooltip>

      {/* Active agent */}
      <Tooltip content={`Active agent: ${activeAgent ?? 'build'}`}>
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-secondary cursor-default">
          <ShieldCheck className="size-3" />
          <span>{activeAgent ?? 'build'}</span>
          {sessionStatus === 'busy' && (
            <div className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
          )}
        </div>
      </Tooltip>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Workspace folder */}
      {workspaceId && folderName && (
        <Tooltip content={workspacePath ?? 'Workspace'}>
          <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-secondary cursor-default">
            <FolderOpen className="size-3" />
            <span>{folderName}</span>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

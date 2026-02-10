/**
 * StatusBar -- bottom bar showing connection, permissions, and git status.
 */

import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { Branch, ShieldCheck, Desktop } from '@openai/apps-sdk-ui/components/Icon';

interface StatusBarProps {
  connected: boolean;
  workspaceId: string | null;
  sessionId: string | null;
}

export function StatusBar({ connected, workspaceId }: StatusBarProps) {
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

      {/* Permission mode */}
      <Tooltip content="Current permission mode for tool execution">
        <Button variant="ghost" color="secondary" size="sm" className="text-[11px]! px-1.5! py-0.5! text-secondary gap-1!">
          <ShieldCheck className="size-3" />
          Default permission
        </Button>
      </Tooltip>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Git status */}
      {workspaceId && (
        <Tooltip content="Initialize a git repository for this workspace">
          <Button variant="ghost" color="secondary" size="sm" className="text-[11px]! px-1.5! py-0.5! text-secondary gap-1!">
            <Branch className="size-3" />
            Create git repository
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

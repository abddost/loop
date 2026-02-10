/**
 * TopBar -- session header with title, status, and action buttons.
 */

import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { Play, DotsHorizontal, ExternalLink, Stop } from '@openai/apps-sdk-ui/components/Icon';
import type { ApiClient } from '../lib/api-client';

interface TopBarProps {
  sessionTitle: string | null;
  sessionStatus: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  apiClient: ApiClient;
  onCancel?: () => void;
}

const statusColorMap: Record<string, 'success' | 'warning' | 'danger' | undefined> = {
  idle: 'success',
  busy: 'warning',
  retry: 'warning',
  error: 'danger',
};

export function TopBar({
  sessionTitle,
  sessionStatus,
  workspaceId,
  sessionId,
  apiClient,
  onCancel,
}: TopBarProps) {
  const handleCancel = async () => {
    if (!workspaceId || !sessionId) return;
    try {
      await apiClient.cancelSession(workspaceId, sessionId);
      onCancel?.();
    } catch (err) {
      console.error('Failed to cancel session:', err);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-subtle min-h-[48px] bg-surface">
      {/* Session title */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        {sessionTitle ? (
          <>
            <h1 className="text-sm font-medium text-default truncate">
              {sessionTitle}
            </h1>
            {sessionStatus && (
              <Badge
                color={statusColorMap[sessionStatus]}
                size="lg"
              >
                {sessionStatus}
              </Badge>
            )}
          </>
        ) : (
          <span className="text-sm text-tertiary">No active session</span>
        )}
      </div>

      {/* Actions */}
      {sessionId && (
        <div className="flex items-center gap-1">
          {sessionStatus === 'busy' ? (
            <Tooltip content="Stop execution">
              <Button
                variant="ghost"
                color="secondary"
                size="sm"
                onClick={handleCancel}
              >
                <Stop className="size-3.5" />
              </Button>
            </Tooltip>
          ) : (
            <Tooltip content="Run">
              <Button variant="ghost" color="secondary" size="sm">
                <Play className="size-3.5" />
              </Button>
            </Tooltip>
          )}

          <Tooltip content="Open in editor">
            <Button variant="ghost" color="secondary" size="sm">
              <ExternalLink className="size-3.5" />
            </Button>
          </Tooltip>

          <Tooltip content="More options">
            <Button variant="ghost" color="secondary" size="sm">
              <DotsHorizontal className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

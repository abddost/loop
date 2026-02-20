/**
 * PermissionDialog -- asks the user to approve/deny a tool action.
 * Uses Alert component from @openai/apps-sdk-ui.
 */

import { useState } from 'react';
import { Alert } from '@openai/apps-sdk-ui/components/Alert';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import type { PermissionRequest } from '@coding-assistant/shared';
import { usePermission } from '../hooks/usePermission';

interface PermissionDialogProps {
  permission: PermissionRequest;
}

const riskBadgeColor: Record<string, 'success' | 'warning' | 'danger'> = {
  safe: 'success',
  moderate: 'warning',
  dangerous: 'danger',
};

/** Format permission metadata for display */
function formatDetail(permission: PermissionRequest): string | null {
  const meta = permission.metadata as Record<string, unknown> | undefined;
  if (!meta) return null;

  if (meta.command) return meta.command as string;
  if (meta.path) return meta.path as string;
  if (meta.filepath) return meta.filepath as string;
  if (meta.url) return meta.url as string;
  if (meta.query) return meta.query as string;
  return null;
}

export function PermissionDialog({ permission }: PermissionDialogProps) {
  const { respond } = usePermission();
  const [showDenyFeedback, setShowDenyFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');

  const detail = formatDetail(permission);

  const handleDeny = () => {
    if (showDenyFeedback) {
      respond(permission.id, false, 'once', feedback || undefined);
      setShowDenyFeedback(false);
      setFeedback('');
    } else {
      setShowDenyFeedback(true);
    }
  };

  return (
    <Alert
      color="warning"
      variant="outline"
      title={
        <span className="flex items-center gap-2">
          Permission Required
          <Badge color={riskBadgeColor[permission.riskLevel] ?? 'warning'} size="lg">
            {permission.riskLevel}
          </Badge>
        </span>
      }
      description={
        <div className="space-y-2">
          <p className="text-sm">{permission.description}</p>
          {detail && (
            <pre className="text-xs bg-surface-secondary rounded p-2 overflow-x-auto max-w-full whitespace-pre-wrap break-all font-mono">
              {detail}
            </pre>
          )}
          <p className="text-xs text-tertiary font-mono">
            Tool: {permission.toolName} | Permission: {permission.permission}
          </p>
          {showDenyFeedback && (
            <div className="mt-2">
              <input
                type="text"
                className="w-full text-sm p-2 rounded border border-border bg-surface-secondary"
                placeholder="Reason for denial (optional, sent to AI)..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleDeny(); }}
                autoFocus
              />
            </div>
          )}
        </div>
      }
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="soft"
            color="success"
            onClick={() => respond(permission.id, true, 'once')}
          >
            Allow Once
          </Button>
          <Button
            size="sm"
            variant="soft"
            color="primary"
            onClick={() => respond(permission.id, true, 'always')}
          >
            Always Allow
          </Button>
          <Button
            size="sm"
            variant="ghost"
            color="secondary"
            onClick={handleDeny}
          >
            {showDenyFeedback ? 'Confirm Deny' : 'Deny'}
          </Button>
        </div>
      }
    />
  );
}

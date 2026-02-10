/**
 * PermissionDialog -- asks the user to approve/deny a tool action.
 * Uses Alert component from @openai/apps-sdk-ui.
 */

import { Alert } from '@openai/apps-sdk-ui/components/Alert';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import type { PermissionRequest } from '@coding-assistant/shared';
import { usePermission } from '../hooks/usePermission';
import type { ApiClient } from '../lib/api-client';

interface PermissionDialogProps {
  permission: PermissionRequest;
  apiClient: ApiClient;
}

const riskBadgeColor: Record<string, 'success' | 'warning' | 'danger'> = {
  safe: 'success',
  moderate: 'warning',
  dangerous: 'danger',
};

export function PermissionDialog({ permission, apiClient }: PermissionDialogProps) {
  const { respond } = usePermission(apiClient);

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
          <p className="text-xs text-tertiary font-mono">
            Tool: {permission.toolName} | Domain: {permission.domain}
          </p>
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
            onClick={() => respond(permission.id, false)}
          >
            Deny
          </Button>
        </div>
      }
    />
  );
}

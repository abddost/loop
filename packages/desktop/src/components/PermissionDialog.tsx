/**
 * PermissionDialog -- asks the user to approve/deny a tool action.
 * Matches the minimal card design: icon + title + badge, detail, action bar.
 */

import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { ShieldCheck } from '@openai/apps-sdk-ui/components/Icon';
import type { PermissionRequest } from '@coding-assistant/shared';
import { usePermission } from '../hooks/usePermission';

interface PermissionDialogProps {
  permission: PermissionRequest;
}

/** Extract the most relevant detail string to display. */
function formatDetail(permission: PermissionRequest): string | null {
  // Prefer patterns (the actual resource being accessed)
  if (permission.patterns?.length > 0 && permission.patterns[0] !== '*') {
    return permission.patterns.join('\n');
  }

  const meta = permission.metadata as Record<string, unknown> | undefined;
  if (!meta) return null;

  if (meta.command) return meta.command as string;
  if (meta.filepath) return meta.filepath as string;
  if (meta.path) return meta.path as string;
  if (meta.url) return meta.url as string;
  if (meta.query) return meta.query as string;
  return null;
}

export function PermissionDialog({ permission }: PermissionDialogProps) {
  const { respond } = usePermission();
  const detail = formatDetail(permission);

  return (
    <div className="rounded-xl border border-subtle overflow-hidden bg-black/20">
      {/* Content */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-4 text-tertiary shrink-0" />
          <span className="text-sm text-secondary">Permission required</span>
          {/* <Badge color="warning" size="sm"> */}
            {permission.permission}
          {/* </Badge> */}
        </div>

        {detail && (
          <p className="text-sm text-primary pl-7 font-mono whitespace-pre-wrap break-all">
            {detail}
          </p>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-end gap-2 px-4 py-2.5">
        <Button
          size="sm"
          variant="ghost"
          color="secondary"
          onClick={() => respond(permission.id, false, 'once')}
        >
          Deny
        </Button>
        <Button
          size="sm"
          variant="outline"
          color="secondary"
          onClick={() => respond(permission.id, true, 'always')}
        >
          Allow always
        </Button>
        <Button
          size="sm"
          variant="solid"
          color="secondary"
          onClick={() => respond(permission.id, true, 'once')}
        >
          Allow once
        </Button>
      </div>
    </div>
  );
}

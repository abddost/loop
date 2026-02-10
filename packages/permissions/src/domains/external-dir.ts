/**
 * External directory access permission domain handler.
 */

import { resolve, relative } from 'node:path';
import type { PermissionDecision } from '@coding-assistant/shared';
import type { DomainHandler, PermissionContext } from '../types.js';

export const externalDirDomain: DomainHandler = {
  domain: 'external-dir',

  evaluate(_toolName, input, ctx): PermissionDecision {
    const filePath = (input as Record<string, unknown>)?.path as string ?? '';
    const resolved = resolve(ctx.workspaceRootPath, filePath);
    const rel = relative(ctx.workspaceRootPath, resolved);

    // If the path is outside the workspace, check external-dir policy
    if (rel.startsWith('..')) {
      const domainPolicy = ctx.policy.domains?.['external-dir'];
      if (!domainPolicy) {
        return { mode: 'deny', reason: 'Access to external directories is denied by default' };
      }
      return { mode: domainPolicy.mode, reason: 'Path is outside workspace' };
    }

    // Within workspace -- not our concern
    return { mode: 'allow' };
  },

  extractScope(_toolName, input): string {
    return (input as Record<string, unknown>)?.path as string ?? '*';
  },
};

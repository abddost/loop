/**
 * Permission engine internal types.
 */

import type { PermissionDomain, PermissionDecision, PermissionPolicy } from '@coding-assistant/shared';

export interface PermissionContext {
  workspaceRootPath: string;
  sessionId: string;
  policy: PermissionPolicy;
}

export interface DomainHandler {
  domain: PermissionDomain;
  evaluate(
    toolName: string,
    input: unknown,
    ctx: PermissionContext,
  ): PermissionDecision;
  extractScope(toolName: string, input: unknown): string;
}

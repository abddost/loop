/**
 * Route helpers for resolving workspace and session from request params.
 *
 * These throw AppError subclasses that the global error-handler middleware
 * already catches and maps to proper HTTP responses (404, 400, etc.).
 */

import { NotFoundError, ValidationError } from '@coding-assistant/shared';
import type { WorkspaceContext, SessionContext } from '@coding-assistant/core';
import { getWorkspaceManager, getSessionManager } from '../services.js';

/**
 * Resolve a workspace by ID. Throws NotFoundError (404) if not found.
 */
export function resolveWorkspace(workspaceId: string | undefined): WorkspaceContext {
  if (!workspaceId) {
    throw new ValidationError('workspaceId is required');
  }

  const workspace = getWorkspaceManager().get(workspaceId);
  if (!workspace) {
    throw new NotFoundError('Workspace', workspaceId);
  }

  return workspace;
}

/**
 * Resolve a session within a workspace. Throws NotFoundError (404) if either
 * the workspace or session is not found.
 *
 * Returns both so callers don't need a separate resolveWorkspace() call.
 */
export function resolveSession(
  workspaceId: string | undefined,
  sessionId: string | undefined,
): { workspace: WorkspaceContext; session: SessionContext } {
  const workspace = resolveWorkspace(workspaceId);

  if (!sessionId) {
    throw new ValidationError('sessionId is required');
  }

  const session = getSessionManager().get(workspace, sessionId);
  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  return { workspace, session };
}

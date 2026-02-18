/**
 * Session-level reducers: session-status, permission-request,
 * permission-response, error.
 *
 * Session-level properties (status, retryInfo, lastError) are
 * handled by the EventStore's shallow clone of SessionState.
 * Array/nested updates use immutable patterns for React.memo.
 */

import type {
  SessionStatusEvent,
  PermissionRequestEvent,
  PermissionResponseEvent,
  ErrorEvent,
  SessionStatus,
  PermissionRequest,
  MessagePart,
} from '@coding-assistant/shared';
import type { SessionState } from '../event-store';
import { lastAssistantMessage, immutablePushPart } from './helpers';

export function applySessionStatus(session: SessionState, event: SessionStatusEvent): void {
  session.status = event.status as SessionStatus;
  if (event.status === 'retry' && event.retryAttempt !== undefined) {
    session.retryInfo = {
      attempt: event.retryAttempt,
      reason: event.retryReason ?? 'Unknown',
      nextAt: event.retryNextAt ?? 0,
    };
  } else {
    session.retryInfo = undefined;
  }
  if (event.status === 'idle') {
    session.lastError = undefined;
  }
}

export function applyPermissionRequest(session: SessionState, event: PermissionRequestEvent): void {
  // Immutable: create new array instead of push
  session.pendingPermissions = [...session.pendingPermissions, {
    id: event.requestId,
    workspaceId: event.workspaceId,
    sessionId: event.sessionId,
    toolName: event.toolName,
    domain: event.domain as PermissionRequest['domain'],
    input: event.input ?? null,
    description: event.description,
    riskLevel: event.riskLevel,
    timestamp: event.timestamp,
  }];
}

export function applyPermissionResponse(session: SessionState, event: PermissionResponseEvent): void {
  session.pendingPermissions = session.pendingPermissions.filter(
    (p) => p.id !== event.requestId,
  );
}

export function applyError(session: SessionState, event: ErrorEvent): void {
  session.lastError = { code: event.code, message: event.message };

  // Immutably add error part to the last assistant message
  const targetMsg = lastAssistantMessage(session);
  if (targetMsg) {
    immutablePushPart(session, targetMsg, {
      type: 'error',
      id: `part_${Date.now()}_err`,
      index: targetMsg.parts.length,
      code: event.code,
      message: event.message,
    } as MessagePart);
  }
}

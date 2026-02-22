/**
 * Abort handler -- cleans up in-flight tools when execution is cancelled.
 */

import type { ToolStatus } from '@coding-assistant/shared';
import { globalEventBus } from '../events/bus.js';
import { mapToolError, type RawStreamEvent } from './stream-mapper.js';

export interface TrackedToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: ToolStatus;
}

/**
 * Mark all in-flight (pending/running) tool calls as errored and emit
 * the corresponding tool-error events.
 */
export function cleanupInflightTools(
  trackedTools: Map<string, TrackedToolCall>,
  scope: { workspaceId: string; sessionId: string; messageId: string },
  message: string = 'Tool execution aborted',
): void {
  for (const tracked of trackedTools.values()) {
    if (tracked.status === 'pending' || tracked.status === 'running') {
      tracked.status = 'error';
      globalEventBus.emit(
        mapToolError(scope, tracked.toolCallId, tracked.toolName, message),
      );
    }
  }
}

/**
 * Transition session back to idle (if not already) and emit the idle status.
 */
export function transitionToIdle(
  session: { state: { status: string; transition(s: string): void } },
  emitFn: (raw: RawStreamEvent) => void,
  scopeNoMsg: { workspaceId: string; sessionId: string },
  mapSessionStatus: (scope: { workspaceId: string; sessionId: string }, status: string) => RawStreamEvent,
): void {
  if (session.state.status !== 'idle') {
    session.state.transition('idle');
  }
  emitFn(mapSessionStatus(scopeNoMsg, 'idle'));
}

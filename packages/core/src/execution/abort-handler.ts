/**
 * Abort handler -- cleans up in-flight tools when execution is cancelled.
 *
 * Extracted from loop.ts where this identical block was duplicated 3 times:
 * once after normal stream completion, once on AbortError, and once on
 * non-retryable errors.
 */

import type { StreamEvent, ToolStatus } from '@coding-assistant/shared';
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
 *
 * Returns the emitted events so the caller can yield them in the generator.
 */
export function cleanupInflightTools(
  trackedTools: Map<string, TrackedToolCall>,
  scope: { workspaceId: string; sessionId: string; messageId: string },
  message: string = 'Tool execution aborted',
): StreamEvent[] {
  const events: StreamEvent[] = [];

  for (const tracked of trackedTools.values()) {
    if (tracked.status === 'pending' || tracked.status === 'running') {
      tracked.status = 'error';
      events.push(
        globalEventBus.emit(
          mapToolError(scope, tracked.toolCallId, tracked.toolName, message),
        ),
      );
    }
  }

  return events;
}

/**
 * Transition session back to idle (if not already) and emit the idle status.
 */
export function transitionToIdle(
  session: { state: { status: string; transition(s: string): void } },
  emitFn: (raw: RawStreamEvent) => StreamEvent,
  scopeNoMsg: { workspaceId: string; sessionId: string },
  mapSessionStatus: (scope: { workspaceId: string; sessionId: string }, status: string) => RawStreamEvent,
): StreamEvent | null {
  if (session.state.status !== 'idle') {
    session.state.transition('idle');
  }
  return emitFn(mapSessionStatus(scopeNoMsg, 'idle'));
}

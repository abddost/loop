/**
 * Tool lifecycle reducers: tool-call-start, tool-call-delta,
 * tool-call-done, tool-result, tool-error.
 *
 * All updates are immutable: new part/message/array references are
 * created for modified items so React.memo can detect changes.
 */

import type {
  ToolCallStartEvent,
  ToolCallDeltaEvent,
  ToolCallDoneEvent,
  ToolResultEvent,
  ToolErrorEvent,
  ToolStatus,
} from '@coding-assistant/shared';
import type { SessionState } from '../event-store';
import {
  findMessage,
  findToolCall,
  immutablePushPart,
  immutableSetPart,
} from './helpers';

/**
 * WeakMap to store streaming arg text for tool calls.
 * Avoids polluting ToolCallPart with untyped properties.
 */
const toolArgsTextMap = new WeakMap<object, string>();

export function applyToolCallStart(session: SessionState, event: ToolCallStartEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;
  immutablePushPart(session, msg, {
    type: 'tool-call',
    id: `part_${Date.now()}`,
    index: msg.parts.length,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    args: {},
    status: 'pending' as ToolStatus,
  });
}

export function applyToolCallDelta(session: SessionState, event: ToolCallDeltaEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;
  const tc = findToolCall(msg, event.toolCallId);
  if (tc) {
    // WeakMap-only update -- no part mutation, no re-render needed.
    const existing = toolArgsTextMap.get(tc) ?? '';
    toolArgsTextMap.set(tc, existing + event.delta);
  }
}

export function applyToolCallDone(session: SessionState, event: ToolCallDoneEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;
  const tc = findToolCall(msg, event.toolCallId);
  if (!tc) return;

  // Clear streaming text for the old reference
  toolArgsTextMap.delete(tc);

  // Immutably replace the tool-call part with updated args and status
  const partIdx = msg.parts.indexOf(tc);
  if (partIdx === -1) return;
  immutableSetPart(session, msg, partIdx, {
    ...tc,
    args: event.args,
    status: 'running' as ToolStatus,
  });
}

export function applyToolResult(session: SessionState, event: ToolResultEvent): void {
  let msg = findMessage(session, event.messageId);
  if (!msg) return;

  // 1. Immutably update the tool-call part status
  const tc = findToolCall(msg, event.toolCallId);
  if (tc) {
    const partIdx = msg.parts.indexOf(tc);
    if (partIdx !== -1) {
      immutableSetPart(session, msg, partIdx, {
        ...tc,
        status: (event.isError ? 'error' : 'completed') as ToolStatus,
      });
      // Re-fetch message after immutable replacement
      msg = findMessage(session, event.messageId)!;
    }
  }

  // 2. Immutably add the result part
  immutablePushPart(session, msg, {
    type: 'tool-result',
    id: `part_${Date.now()}`,
    index: msg.parts.length,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    output: event.result,
    isError: event.isError,
    ...(event.durationMs != null ? { durationMs: event.durationMs } : {}),
  });
}

export function applyToolError(session: SessionState, event: ToolErrorEvent): void {
  let msg = findMessage(session, event.messageId);
  if (!msg) return;

  // 1. Immutably update the tool-call part status to error
  const tc = findToolCall(msg, event.toolCallId);
  if (tc) {
    const partIdx = msg.parts.indexOf(tc);
    if (partIdx !== -1) {
      immutableSetPart(session, msg, partIdx, {
        ...tc,
        status: 'error' as ToolStatus,
      });
      // Re-fetch message after immutable replacement
      msg = findMessage(session, event.messageId)!;
    }
  }

  // 2. Immutably add a tool-result part with error flag
  immutablePushPart(session, msg, {
    type: 'tool-result',
    id: `part_${Date.now()}`,
    index: msg.parts.length,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    output: event.error,
    isError: true,
  });
}

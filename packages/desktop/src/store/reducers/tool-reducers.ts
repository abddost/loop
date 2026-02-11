/**
 * Tool lifecycle reducers: tool-call-start, tool-call-delta,
 * tool-call-done, tool-result, tool-error.
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
import { findMessage, findToolCall } from './helpers';

/**
 * WeakMap to store streaming arg text for tool calls.
 * Avoids polluting ToolCallPart with untyped properties.
 */
const toolArgsTextMap = new WeakMap<object, string>();

export function applyToolCallStart(session: SessionState, event: ToolCallStartEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;
  msg.parts.push({
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
    const existing = toolArgsTextMap.get(tc) ?? '';
    toolArgsTextMap.set(tc, existing + event.delta);
  }
}

export function applyToolCallDone(session: SessionState, event: ToolCallDoneEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;
  const tc = findToolCall(msg, event.toolCallId);
  if (tc) {
    tc.args = event.args;
    tc.status = 'running';
    // Clear streaming text now that we have the final args
    toolArgsTextMap.delete(tc);
  }
}

export function applyToolResult(session: SessionState, event: ToolResultEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;

  // Update the tool-call part status
  const tc = findToolCall(msg, event.toolCallId);
  if (tc) {
    tc.status = event.isError ? 'error' : 'completed';
  }

  // Add the result part
  msg.parts.push({
    type: 'tool-result',
    id: `part_${Date.now()}`,
    index: msg.parts.length,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    result: event.result,
    isError: event.isError,
  });
}

export function applyToolError(session: SessionState, event: ToolErrorEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;

  // Update the tool-call part status to error
  const tc = findToolCall(msg, event.toolCallId);
  if (tc) {
    tc.status = 'error';
  }

  // Add a tool-result part with error flag
  msg.parts.push({
    type: 'tool-result',
    id: `part_${Date.now()}`,
    index: msg.parts.length,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    result: event.error,
    isError: true,
  });
}

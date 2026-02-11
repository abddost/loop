/**
 * Shared reducer helpers for EventStore.
 *
 * Extracted to avoid duplication across text, reasoning, tool,
 * message, and session reducers.
 *
 * IMMUTABLE UPDATE PATTERN: All helpers that modify messages or parts
 * create new object references so that React.memo can detect changes.
 * Unmodified messages/parts keep their old references for efficient
 * memoization (only changed items trigger re-renders).
 */

import type { UIMessage, ToolCallPart, MessagePart } from '@coding-assistant/shared';
import type { SessionState } from '../event-store';

// ---------------------------------------------------------------------------
//  Read-only helpers (no mutations)
// ---------------------------------------------------------------------------

/** O(1) message lookup by id, with fallback to linear scan. */
export function findMessage(session: SessionState, messageId: string): UIMessage | undefined {
  return session.messageIndex.get(messageId)
    ?? session.messages.find((m) => m.id === messageId);
}

/** Get the last assistant message in the session. */
export function lastAssistantMessage(session: SessionState): UIMessage | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i].role === 'assistant') return session.messages[i];
  }
  return undefined;
}

/** Find a tool-call part by toolCallId within a message. */
export function findToolCall(msg: UIMessage, toolCallId: string): ToolCallPart | undefined {
  return msg.parts.find(
    (p): p is ToolCallPart => p.type === 'tool-call' && p.toolCallId === toolCallId,
  );
}

/**
 * Find the last text/reasoning part in a message.
 * Used for legacy fallback where no partId is provided.
 */
export function findLastPartByType(
  msg: UIMessage,
  type: 'text' | 'reasoning',
): (MessagePart & { text: string }) | undefined {
  for (let i = msg.parts.length - 1; i >= 0; i--) {
    const p = msg.parts[i];
    if (p.type === type && 'text' in p) {
      return p as MessagePart & { text: string };
    }
  }
  return undefined;
}

/** Find a part by its id and type. */
export function findPartById(
  msg: UIMessage,
  partId: string,
  type: 'text' | 'reasoning',
): (MessagePart & { text: string }) | undefined {
  const part = msg.parts.find((p) => p.type === type && p.id === partId);
  if (part && 'text' in part) {
    return part as MessagePart & { text: string };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
//  Immutable update helpers
// ---------------------------------------------------------------------------

/**
 * Replace a message in the session's messages array and messageIndex.
 * Creates a new messages array with the replacement at the correct index.
 * Unmodified messages keep their old references for React.memo efficiency.
 */
export function replaceMessage(session: SessionState, newMsg: UIMessage): void {
  const oldMsg = session.messageIndex.get(newMsg.id);
  if (!oldMsg) return;

  const idx = session.messages.indexOf(oldMsg);
  if (idx !== -1) {
    const newMessages = session.messages.slice();
    newMessages[idx] = newMsg;
    session.messages = newMessages;
  }
  session.messageIndex.set(newMsg.id, newMsg);
}

/**
 * Immutably append a new message to the session.
 * Creates a new messages array (old messages keep their references).
 */
export function pushMessage(session: SessionState, msg: UIMessage): void {
  session.messages = [...session.messages, msg];
  session.messageIndex.set(msg.id, msg);
}

/**
 * Immutably append a part to a message.
 * Creates a new parts array and a new message object.
 * Updates the session's messages array and messageIndex.
 */
export function immutablePushPart(
  session: SessionState,
  msg: UIMessage,
  part: MessagePart,
): void {
  const newMsg: UIMessage = { ...msg, parts: [...msg.parts, part] };
  replaceMessage(session, newMsg);
}

/**
 * Immutably replace a part in a message at the given index.
 * Creates a new parts array, new message object, and updates the session.
 * All other parts keep their old references for React.memo efficiency.
 */
export function immutableSetPart(
  session: SessionState,
  msg: UIMessage,
  partIndex: number,
  newPart: MessagePart,
): void {
  const newParts = msg.parts.slice();
  newParts[partIndex] = newPart;
  const newMsg: UIMessage = { ...msg, parts: newParts };
  replaceMessage(session, newMsg);
}

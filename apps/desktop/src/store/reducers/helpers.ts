/**
 * Shared reducer helpers for EventStore.
 *
 * Extracted to avoid duplication across text, reasoning, tool,
 * message, and session reducers.
 */

import type { UIMessage, ToolCallPart, MessagePart } from '@coding-assistant/shared';
import type { SessionState } from '../event-store';

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

/** Register a new message in both the array and the index. */
export function pushMessage(session: SessionState, msg: UIMessage): void {
  session.messages.push(msg);
  session.messageIndex.set(msg.id, msg);
}

/** Find a tool-call part by toolCallId within a message. */
export function findToolCall(msg: UIMessage, toolCallId: string): ToolCallPart | undefined {
  return msg.parts.find(
    (p): p is ToolCallPart => p.type === 'tool-call' && p.toolCallId === toolCallId,
  );
}

/**
 * Find or create a text/reasoning part in a message.
 *
 * Used for both text-delta and reasoning-delta legacy fallback
 * where no partId is provided.
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

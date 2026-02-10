/**
 * Context protection rules -- determines what must NOT be pruned.
 */

import type { Message, MessagePart } from '@coding-assistant/shared';

export interface ProtectionRule {
  name: string;
  shouldProtect: (message: Message, index: number, total: number) => boolean;
}

/**
 * Protect the most recent N messages.
 */
export function recentMessages(count: number): ProtectionRule {
  return {
    name: `recent-${count}`,
    shouldProtect: (_msg, index, total) => index >= total - count,
  };
}

/**
 * Protect messages containing active todo items.
 */
export function activeTodos(): ProtectionRule {
  return {
    name: 'active-todos',
    shouldProtect: (msg) => {
      return msg.parts.some(
        (part) =>
          part.type === 'tool-call' &&
          (part.toolName === 'todo-write' || part.toolName === 'todo-read'),
      );
    },
  };
}

/**
 * Protect messages containing file writes/edits (latest diffs).
 */
export function recentEdits(count: number): ProtectionRule {
  let editCount = 0;
  return {
    name: `recent-edits-${count}`,
    shouldProtect: (msg) => {
      const hasEdit = msg.parts.some(
        (part: MessagePart) =>
          part.type === 'tool-call' &&
          ['file-write', 'file-edit', 'file-patch'].includes(part.toolName),
      );
      if (hasEdit && editCount < count) {
        editCount++;
        return true;
      }
      return false;
    },
  };
}

/**
 * Protect the first user message (original task).
 */
export function firstUserMessage(): ProtectionRule {
  return {
    name: 'first-user',
    shouldProtect: (msg, index) => index === 0 && msg.role === 'user',
  };
}

/**
 * Apply all protection rules to determine which messages are protected.
 */
export function getProtectedIndices(
  messages: readonly Message[],
  rules: ProtectionRule[],
): Set<number> {
  const protected_ = new Set<number>();

  for (let i = 0; i < messages.length; i++) {
    for (const rule of rules) {
      if (rule.shouldProtect(messages[i], i, messages.length)) {
        protected_.add(i);
        break;
      }
    }
  }

  return protected_;
}

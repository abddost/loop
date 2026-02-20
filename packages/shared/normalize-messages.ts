/**
 * Normalize a message array by merging tool-result parts from standalone
 * `role:'tool'` messages into the preceding assistant message that contains
 * the matching `tool-call` parts.
 *
 * This fixes backward-compatible loading of sessions that were persisted
 * before the merge fix (tool-call and tool-result were on separate messages).
 * After normalization the frontend can always find matching tool-result parts
 * within the same message, which is what MessagePartRenderer expects.
 */

import type { MessagePart, ToolCallPart, ToolResultPart, ToolStatus } from './types/session.js';

export function normalizeMessages<T extends { role: string; parts: MessagePart[] }>(
  messages: T[],
): T[] {
  const result: T[] = [];
  let lastAssistant: T | null = null;

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      lastAssistant = msg;
      result.push(msg);
      continue;
    }

    if (msg.role === 'tool' && lastAssistant) {
      const toolResultParts = msg.parts.filter(
        (p): p is ToolResultPart => p.type === 'tool-result',
      );

      if (toolResultParts.length > 0) {
        const existingToolCallIds = new Set(
          lastAssistant.parts
            .filter((p): p is ToolCallPart => p.type === 'tool-call')
            .map((p) => p.toolCallId),
        );

        const partsToMerge = toolResultParts.filter(
          (p) => existingToolCallIds.has(p.toolCallId),
        );

        if (partsToMerge.length > 0) {
          const mergedParts = [...lastAssistant.parts, ...partsToMerge];
          for (let i = 0; i < mergedParts.length; i++) mergedParts[i].index = i;

          const resultCallIds = new Set(partsToMerge.map((p) => p.toolCallId));
          for (const part of mergedParts) {
            if (
              part.type === 'tool-call' &&
              resultCallIds.has(part.toolCallId) &&
              (part.status === 'pending' || part.status === 'running')
            ) {
              const trPart = partsToMerge.find((r) => r.toolCallId === part.toolCallId);
              (part as ToolCallPart).status = (trPart?.isError ? 'error' : 'completed') as ToolStatus;
            }
          }

          lastAssistant.parts = mergedParts;

          const remaining = msg.parts.filter(
            (p) => p.type !== 'tool-result' || !existingToolCallIds.has((p as ToolResultPart).toolCallId),
          );
          if (remaining.length > 0) {
            result.push({ ...msg, parts: remaining });
          }
          continue;
        }
      }
    }

    result.push(msg);
    if (msg.role !== 'tool') lastAssistant = null;
  }

  return result;
}

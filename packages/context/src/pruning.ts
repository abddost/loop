/**
 * Context pruning -- removes messages that are safe to drop.
 */

import type { Message } from '@coding-assistant/shared';
import { estimateTokenCount } from './budget.js';
import { getProtectedIndices, type ProtectionRule } from './protections.js';

export interface PruningResult {
  messages: Message[];
  prunedCount: number;
  prunedTokens: number;
}

/**
 * Prune messages to fit within token budget.
 * Removes oldest unprotected messages first.
 */
export function pruneMessages(
  messages: readonly Message[],
  targetTokens: number,
  rules: ProtectionRule[],
): PruningResult {
  const protectedIndices = getProtectedIndices(messages, rules);
  let currentTokens = estimateTokenCount(messages);

  if (currentTokens <= targetTokens) {
    return {
      messages: [...messages],
      prunedCount: 0,
      prunedTokens: 0,
    };
  }

  // Build list of prunable messages sorted by priority (oldest first)
  const prunable = messages
    .map((msg, idx) => ({ msg, idx }))
    .filter(({ idx }) => !protectedIndices.has(idx));

  const kept = new Set(messages.map((_, i) => i));
  let prunedCount = 0;
  let prunedTokens = 0;

  for (const { msg, idx } of prunable) {
    if (currentTokens <= targetTokens) break;

    const msgTokens = estimateTokenCount([msg]);
    currentTokens -= msgTokens;
    prunedTokens += msgTokens;
    prunedCount++;
    kept.delete(idx);
  }

  const result = messages.filter((_, i) => kept.has(i));

  return {
    messages: result,
    prunedCount,
    prunedTokens,
  };
}

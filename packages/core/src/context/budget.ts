/**
 * Context budget management.
 * Estimates token usage and determines when compaction is needed.
 */

import type { Message } from '@coding-assistant/shared';
import { CONTEXT_BUDGET_RATIO } from '@coding-assistant/shared';

/**
 * Rough token estimation based on character count.
 * ~4 characters per token on average.
 */
export function estimateTokenCount(messages: readonly Message[]): number {
  let total = 0;

  for (const message of messages) {
    for (const part of message.parts) {
      switch (part.type) {
        case 'text':
        case 'reasoning':
          total += Math.ceil(part.text.length / 4);
          break;
        case 'tool-call':
          total += Math.ceil(JSON.stringify(part.args).length / 4) + 50;
          break;
        case 'tool-result':
          total += Math.ceil(JSON.stringify(part.result).length / 4) + 20;
          break;
        default:
          total += 50; // Base overhead per part
      }
    }

    // Per-message overhead
    total += 10;
  }

  return total;
}

/**
 * Check if compaction is needed based on token budget.
 */
export function shouldCompact(
  messages: readonly Message[],
  contextLimit: number,
  budgetRatio: number = CONTEXT_BUDGET_RATIO,
): boolean {
  const currentTokens = estimateTokenCount(messages);
  return currentTokens > contextLimit * budgetRatio;
}

/**
 * Calculate remaining budget.
 */
export function remainingBudget(
  messages: readonly Message[],
  contextLimit: number,
): number {
  return contextLimit - estimateTokenCount(messages);
}

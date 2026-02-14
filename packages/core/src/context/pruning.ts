/**
 * Context pruning -- removes messages that are safe to drop.
 *
 * CRITICAL INVARIANT: Tool-call / tool-result pairs must always be kept
 * or removed together.  AI SDK v6 validates that every tool-call in an
 * assistant message has a matching tool-result; violating this causes
 * `AI_MissingToolResultsError` and crashes the execution loop.
 *
 * We achieve this by grouping messages into "turns":
 *   - A user turn is a single user message.
 *   - An assistant turn is an assistant message followed by zero or more
 *     tool messages (which carry the tool-results).
 * Pruning always removes entire turns, never individual messages.
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
 * A "turn" is the atomic unit for pruning.
 * - User turn: a single user message.
 * - Assistant turn: an assistant message + its trailing tool messages.
 */
interface Turn {
  /** Indices into the original messages array */
  indices: number[];
  /** Estimated token count for this turn */
  tokens: number;
  /** Whether any message in this turn is protected */
  isProtected: boolean;
}

/**
 * Group messages into turns so we never split an assistant message
 * from its tool-result messages.
 */
function groupIntoTurns(
  messages: readonly Message[],
  protectedIndices: Set<number>,
): Turn[] {
  const turns: Turn[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'user') {
      turns.push({
        indices: [i],
        tokens: estimateTokenCount([msg]),
        isProtected: protectedIndices.has(i),
      });
      i++;
    } else if (msg.role === 'assistant') {
      // Collect assistant + all immediately following tool messages
      const indices = [i];
      // Summary messages are compaction boundaries -- always protect them
      let isProtected = protectedIndices.has(i) || msg.summary === true;
      i++;

      while (i < messages.length && messages[i].role === 'tool') {
        indices.push(i);
        if (protectedIndices.has(i)) isProtected = true;
        i++;
      }

      const turnMessages = indices.map((idx) => messages[idx]);
      turns.push({
        indices,
        tokens: estimateTokenCount(turnMessages),
        isProtected,
      });
    } else {
      // Standalone tool message (shouldn't normally happen, but handle it)
      turns.push({
        indices: [i],
        tokens: estimateTokenCount([msg]),
        isProtected: protectedIndices.has(i),
      });
      i++;
    }
  }

  return turns;
}

/**
 * Prune messages to fit within token budget.
 * Removes oldest unprotected *turns* first (never individual messages)
 * to preserve tool-call / tool-result pairing.
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

  const turns = groupIntoTurns(messages, protectedIndices);

  // Prune oldest unprotected turns first
  const prunedIndices = new Set<number>();
  let prunedCount = 0;
  let prunedTokens = 0;

  for (const turn of turns) {
    if (currentTokens <= targetTokens) break;
    if (turn.isProtected) continue;

    for (const idx of turn.indices) {
      prunedIndices.add(idx);
    }
    currentTokens -= turn.tokens;
    prunedTokens += turn.tokens;
    prunedCount += turn.indices.length;
  }

  const result = messages.filter((_, i) => !prunedIndices.has(i));

  // Post-pruning validation: ensure no orphaned tool-calls remain
  const validated = ensureToolCallPairing(result);

  return {
    messages: validated,
    prunedCount,
    prunedTokens,
  };
}

/**
 * Safety net: ensure every tool-call in an assistant message has a matching
 * tool-result somewhere in the messages that follow it.  If any orphaned
 * tool-calls are found, strip them from the assistant message content.
 *
 * This handles edge cases the turn-grouping might miss (e.g. tool messages
 * that were persisted in unexpected order).
 */
function ensureToolCallPairing(messages: Message[]): Message[] {
  // Collect all tool-result IDs
  const resultIds = new Set<string>();
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'tool-result') {
        resultIds.add(part.toolCallId);
      }
    }
  }

  // Check each assistant message for orphaned tool-calls
  return messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;

    const hasToolCalls = msg.parts.some((p) => p.type === 'tool-call');
    if (!hasToolCalls) return msg;

    const orphanedCallIds: string[] = [];
    for (const part of msg.parts) {
      if (part.type === 'tool-call' && !resultIds.has(part.toolCallId)) {
        orphanedCallIds.push(part.toolCallId);
      }
    }

    if (orphanedCallIds.length === 0) return msg;

    // Strip orphaned tool-call parts
    const orphanedSet = new Set(orphanedCallIds);
    const filteredParts = msg.parts.filter(
      (p) => p.type !== 'tool-call' || !orphanedSet.has(p.toolCallId),
    );

    return { ...msg, parts: filteredParts };
  });
}

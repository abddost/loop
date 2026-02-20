/**
 * Lightweight tool-output pruning.
 *
 * This is the "first tier" of context management (complementary to full
 * turn-level pruning in pruning.ts and LLM compaction in compaction.ts).
 *
 * Rather than removing entire messages, it keeps the tool-call structure
 * intact (name + arguments) but clears the large output content of old
 * tool-result parts.  This way the LLM still sees "I called grep with
 * these args" but doesn't get the 50KB grep output from 20 turns ago.
 *
 * Runs after every execution, not just on context overflow.
 *
 * Thresholds (modeled after OpenCode's compaction.ts):
 *   PRUNE_PROTECT = 40,000 tokens -- accumulate this much tool output
 *     before starting to prune (protects recent context).
 *   PRUNE_MINIMUM = 20,000 tokens -- only apply pruning if at least this
 *     many tokens would be freed (avoids thrashing).
 */

import type { Message, ToolResultPart } from '@coding-assistant/shared';

// ── Constants ────────────────────────────────────────────────────────────

/** Keep at least this many tokens of tool output before pruning older ones. */
const PRUNE_PROTECT = 40_000;

/** Only apply pruning if at least this many tokens would be freed. */
const PRUNE_MINIMUM = 20_000;

/** Tool names whose output should never be pruned. */
const PRUNE_PROTECTED_TOOLS = new Set(['agent-instructions']);

// ── Types ────────────────────────────────────────────────────────────────

export interface ToolOutputPruneResult {
  /** Number of tool-result parts whose output was cleared. */
  prunedParts: number;
  /** Estimated tokens freed by clearing outputs. */
  tokensFreed: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Rough token estimate for a single tool-result part's output. */
function estimatePartTokens(part: ToolResultPart): number {
  if (part.compacted) return 10; // Already cleared, minimal tokens
  const raw = typeof part.output === 'string'
    ? part.output
    : JSON.stringify(part.output);
  return Math.ceil(raw.length / 4) + 20; // ~4 chars/token + overhead
}

// ── Main function ────────────────────────────────────────────────────────

/**
 * Walk backward through messages, marking old tool-result outputs as compacted.
 *
 * Algorithm:
 * 1. Skip the most recent 2 user turns (never prune fresh context).
 * 2. Stop at any `summary` message (compaction boundary).
 * 3. Accumulate tool output tokens; after PRUNE_PROTECT tokens are
 *    "protected", start collecting older outputs for pruning.
 * 4. Only apply pruning if >= PRUNE_MINIMUM tokens would be freed.
 * 5. Mark pruned parts: set `compacted = true`, replace `result` with
 *    a placeholder string.
 *
 * Messages are mutated **in-place** for efficiency.
 */
export function pruneToolOutputs(messages: Message[]): ToolOutputPruneResult {
  let totalToolTokens = 0;
  let freedTokens = 0;
  const toPrune: Array<{ msgIndex: number; partIndex: number; tokens: number }> = [];
  let userTurns = 0;

  // Walk backward through messages
  for (let msgIdx = messages.length - 1; msgIdx >= 0; msgIdx--) {
    const msg = messages[msgIdx];

    // Count user messages as turn boundaries
    if (msg.role === 'user') userTurns++;

    // Skip first 2 user turns (protect recent context)
    if (userTurns < 2) continue;

    // Stop at summary messages (compaction boundary)
    if (msg.summary === true) break;

    // Walk backward through parts within the message
    for (let partIdx = msg.parts.length - 1; partIdx >= 0; partIdx--) {
      const part = msg.parts[partIdx];

      // Only process tool-result parts
      if (part.type !== 'tool-result') continue;

      const trPart = part as ToolResultPart;

      // Stop at already-compacted parts (we've reached a previous pruning boundary)
      if (trPart.compacted) break;

      // Never prune protected tools
      if (PRUNE_PROTECTED_TOOLS.has(trPart.toolName)) continue;

      const partTokens = estimatePartTokens(trPart);
      totalToolTokens += partTokens;

      // Only start pruning after accumulating PRUNE_PROTECT tokens of output
      if (totalToolTokens > PRUNE_PROTECT) {
        toPrune.push({ msgIndex: msgIdx, partIndex: partIdx, tokens: partTokens });
        freedTokens += partTokens;
      }
    }
  }

  // Only apply if the savings are worth the mutation
  if (freedTokens < PRUNE_MINIMUM) {
    return { prunedParts: 0, tokensFreed: 0 };
  }

  // Apply: mark parts as compacted and replace result
  for (const { msgIndex, partIndex } of toPrune) {
    const part = messages[msgIndex].parts[partIndex] as ToolResultPart;
    part.output = '[Old tool result content cleared]';
    part.compacted = true;
  }

  return { prunedParts: toPrune.length, tokensFreed: freedTokens };
}

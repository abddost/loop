/**
 * Tool loop prevention domain handler.
 * Detects repetitive tool usage patterns.
 */

import type { PermissionDecision } from '@coding-assistant/shared';
import type { DomainHandler, PermissionContext } from '../types.js';

interface ToolCallRecord {
  toolName: string;
  inputHash: string;
  timestamp: number;
}

// Per-session call history for loop detection
const callHistory = new Map<string, ToolCallRecord[]>();

const MAX_HISTORY = 50;
const LOOP_THRESHOLD = 3; // Same tool+input 3 times = loop
const LOOP_WINDOW_MS = 60_000; // Within 1 minute

function hashInput(input: unknown): string {
  return JSON.stringify(input).slice(0, 200);
}

export const toolLoopDomain: DomainHandler = {
  domain: 'tool-loop',

  evaluate(toolName, input, ctx): PermissionDecision {
    const sessionId = ctx.sessionId;
    const history = callHistory.get(sessionId) ?? [];
    const now = Date.now();
    const inputHash = hashInput(input);

    // Count recent identical calls
    const recentIdentical = history.filter(
      (r) =>
        r.toolName === toolName &&
        r.inputHash === inputHash &&
        now - r.timestamp < LOOP_WINDOW_MS,
    ).length;

    // Record this call
    history.push({ toolName, inputHash, timestamp: now });
    if (history.length > MAX_HISTORY) {
      history.shift();
    }
    callHistory.set(sessionId, history);

    if (recentIdentical >= LOOP_THRESHOLD) {
      return {
        mode: 'ask',
        reason: `Tool ${toolName} called ${recentIdentical + 1} times with same input in ${LOOP_WINDOW_MS / 1000}s`,
      };
    }

    return { mode: 'allow' };
  },

  extractScope(toolName, _input): string {
    return toolName;
  },
};

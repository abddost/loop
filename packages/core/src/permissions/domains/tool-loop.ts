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

/** Configurable thresholds for loop detection */
export interface ToolLoopConfig {
  threshold?: number;   // default 3
  windowMs?: number;    // default 60000
  maxHistory?: number;  // default 50
}

// Per-session call history for loop detection
const callHistory = new Map<string, ToolCallRecord[]>();

const DEFAULT_THRESHOLD = 3;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_HISTORY = 50;

function hashInput(input: unknown): string {
  if (input === undefined || input === null) return 'null';
  try {
    return (JSON.stringify(input) ?? 'null').slice(0, 200);
  } catch {
    return 'unstringifiable';
  }
}

/**
 * Clean up tool-loop history for a session.
 * Call this when a session is disposed to prevent memory leaks.
 */
export function clearToolLoopHistory(sessionId: string): void {
  callHistory.delete(sessionId);
}

export const toolLoopDomain: DomainHandler = {
  domain: 'tool-loop',

  evaluate(toolName, input, ctx): PermissionDecision {
    const sessionId = ctx.sessionId;
    const history = callHistory.get(sessionId) ?? [];
    const now = Date.now();
    const inputHash = hashInput(input);

    // Read configurable thresholds from policy if available
    const loopConfig = ctx.policy.toolLoop;
    const threshold = loopConfig?.threshold ?? DEFAULT_THRESHOLD;
    const windowMs = loopConfig?.windowMs ?? DEFAULT_WINDOW_MS;
    const maxHistory = loopConfig?.maxHistory ?? DEFAULT_MAX_HISTORY;

    // Count recent identical calls
    const recentIdentical = history.filter(
      (r) =>
        r.toolName === toolName &&
        r.inputHash === inputHash &&
        now - r.timestamp < windowMs,
    ).length;

    // Record this call
    history.push({ toolName, inputHash, timestamp: now });
    if (history.length > maxHistory) {
      history.shift();
    }
    callHistory.set(sessionId, history);

    if (recentIdentical >= threshold) {
      return {
        mode: 'ask',
        reason: `Tool ${toolName} called ${recentIdentical + 1} times with same input in ${windowMs / 1000}s`,
      };
    }

    return { mode: 'allow' };
  },

  extractScope(toolName, _input): string {
    return toolName;
  },
};

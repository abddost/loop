/**
 * ToolCallTracker -- tracks in-flight tool calls for abort cleanup
 * and detects doom loops (repeated identical tool calls).
 *
 * Extracted from loop.ts to isolate the tool call tracking and
 * doom loop detection concerns.
 */

import type { ToolStatus } from '@coding-assistant/shared';
import type { TrackedToolCall } from './abort-handler.js';
import { DOOM_LOOP_THRESHOLD } from '../constants.js';

export class ToolCallTracker {
  /** Active tool calls indexed by toolCallId */
  private tracked = new Map<string, TrackedToolCall>();
  /** Ordered history of call signatures for doom loop detection */
  private callHistory: string[] = [];
  /** Whether a doom loop was detected */
  private _doomLoopDetected = false;

  constructor(private doomLoopThreshold: number = DOOM_LOOP_THRESHOLD) {}

  /** Whether a doom loop was detected. */
  get doomLoopDetected(): boolean {
    return this._doomLoopDetected;
  }

  /** The underlying tracked tools map (for abort-handler cleanup). */
  get trackedTools(): Map<string, TrackedToolCall> {
    return this.tracked;
  }

  /**
   * Record a new tool call. Returns true if a doom loop is detected.
   */
  recordToolCall(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): boolean {
    // Track for abort cleanup
    this.tracked.set(toolCallId, {
      toolCallId,
      toolName,
      args,
      status: 'running',
    });

    // Record signature for doom loop detection
    const signature = `${toolName}:${JSON.stringify(args)}`;
    this.callHistory.push(signature);

    // Check for doom loop
    if (this.callHistory.length >= this.doomLoopThreshold) {
      const lastN = this.callHistory.slice(-this.doomLoopThreshold);
      const allSame = lastN.every((sig) => sig === lastN[0]);
      if (allSame) {
        this._doomLoopDetected = true;
        return true;
      }
    }

    return false;
  }

  /**
   * Update the status of a tracked tool call.
   */
  updateStatus(toolCallId: string, status: ToolStatus): void {
    const entry = this.tracked.get(toolCallId);
    if (entry) {
      entry.status = status;
    }
  }
}

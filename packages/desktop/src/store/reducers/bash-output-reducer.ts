/**
 * Bash output streaming reducer — accumulates real-time output chunks.
 */

import type { BashOutputEvent } from '@coding-assistant/shared';
import type { SessionState } from '../event-store';

/** Max accumulated output per tool call for UI performance */
const MAX_STREAMING_BYTES = 50_000;

/**
 * Per-session streaming output accumulator.
 * Keyed by toolCallId → accumulated output string.
 */
const streamingBuffers = new Map<string, { content: string; totalBytes: number }>();

export function applyBashOutput(_session: SessionState, event: BashOutputEvent): void {
  const key = `${event.sessionId}:${event.toolCallId}`;
  const existing = streamingBuffers.get(key) ?? { content: '', totalBytes: 0 };

  if (existing.totalBytes < MAX_STREAMING_BYTES) {
    existing.content += event.chunk;
    existing.totalBytes = event.totalBytes;
    streamingBuffers.set(key, existing);
  }
}

export function getStreamingOutput(sessionId: string, toolCallId: string): string | undefined {
  return streamingBuffers.get(`${sessionId}:${toolCallId}`)?.content;
}

export function clearStreamingOutput(sessionId: string, toolCallId: string): void {
  streamingBuffers.delete(`${sessionId}:${toolCallId}`);
}

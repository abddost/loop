/**
 * Auto-Summary -- generates session titles from conversation content.
 *
 * After the first assistant response in a session, generates a short
 * title summarizing the conversation topic. This is used for the
 * session sidebar listing.
 *
 * Uses a lightweight approach: extracts the first user message and
 * first assistant response, then generates a title locally
 * (or optionally via a summarize subagent).
 */

import type { Message } from '@coding-assistant/shared';
import { SESSION_TITLE_MAX_LENGTH } from '../constants.js';

/**
 * Generate a short title for a session based on its messages.
 * Uses a simple heuristic: takes the first user message and truncates.
 * For production, this should delegate to a summarize subagent.
 */
export function generateSessionTitle(messages: readonly Message[]): string {
  // Find the first user message
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New session';

  const textParts = firstUser.parts.filter((p) => p.type === 'text');
  if (textParts.length === 0) return 'New session';

  const text = (textParts[0] as { text: string }).text.trim();
  if (!text) return 'New session';

  // Truncate to a reasonable title length
  if (text.length <= SESSION_TITLE_MAX_LENGTH) return text;

  // Try to break at a word boundary
  const truncated = text.slice(0, SESSION_TITLE_MAX_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > SESSION_TITLE_MAX_LENGTH * 0.5) {
    return truncated.slice(0, lastSpace) + '...';
  }
  return truncated + '...';
}

/**
 * Determine if a session needs a title generated.
 * Returns true if the session has at least one assistant response
 * but no title has been set yet.
 */
export function needsTitle(currentTitle: string | null, messages: readonly Message[]): boolean {
  if (currentTitle && currentTitle !== 'New session') return false;
  return messages.some((m) => m.role === 'assistant' && m.parts.length > 0);
}

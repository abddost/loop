/**
 * Agent-mode reminder injection.
 *
 * Appends synthetic text parts to the last user message to guide the LLM's
 * behavior based on the current agent mode.
 *
 * - When agent is "plan": injects PLAN_MODE_REMINDER (readonly constraints)
 * - When switching from "plan" to "build": injects BUILD_SWITCH_REMINDER
 *
 * Injected parts are marked `synthetic: true` so they are excluded from
 * compaction summaries and title generation.
 *
 * Modeled after OpenCode's insertReminders() in session/prompt.ts.
 */

import type { Message, TextPart } from '@coding-assistant/shared';
import { generatePartId } from '@coding-assistant/shared';
import { PLAN_MODE_REMINDER, BUILD_SWITCH_REMINDER } from '../agents/prompts/plan-reminder.js';

/**
 * Inject agent-mode reminders into the message history.
 *
 * Returns a new array with the last user message's parts augmented.
 * Does NOT mutate the original messages.
 */
export function insertReminders(
  messages: readonly Message[],
  currentAgentId: string,
  previousAgentId?: string | null,
): Message[] {
  const lastUserIdx = findLastIndex(messages, (m) => m.role === 'user');
  if (lastUserIdx === -1) return [...messages];

  // Shallow-copy the array and the last user message + its parts
  const result = [...messages];
  const lastUser: Message = {
    ...result[lastUserIdx],
    parts: [...result[lastUserIdx].parts],
  };
  result[lastUserIdx] = lastUser;

  // Plan mode: inject readonly constraints
  if (currentAgentId === 'plan') {
    lastUser.parts.push(createSyntheticTextPart(PLAN_MODE_REMINDER));
  }

  // Plan -> build switch: inject permission-restored notice
  const wasPlan =
    previousAgentId === 'plan' ||
    messages.some(
      (m) => m.role === 'assistant' && m.modelId != null && m.modelId.includes('plan'),
    );

  if (wasPlan && currentAgentId !== 'plan') {
    lastUser.parts.push(createSyntheticTextPart(BUILD_SWITCH_REMINDER));
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function createSyntheticTextPart(text: string): TextPart {
  return {
    type: 'text',
    id: generatePartId(),
    index: 0, // will be at end of parts array
    text,
    synthetic: true,
  };
}

function findLastIndex<T>(arr: readonly T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

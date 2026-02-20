/**
 * Message Preparation -- reads messages from timeline and injects reminders.
 *
 * Extracted from loop.ts (lines 439-471) to isolate the message reading
 * and reminder injection concern.
 */

import type { Message, AgentProfile } from '@coding-assistant/shared';
import type { SessionContext } from '../session/context.js';
import { insertReminders, buildTaskReminder } from './reminders.js';
import { MAX_STEPS_REMINDER } from '../agents/prompts/max-steps.js';

/**
 * Read messages from the session timeline and inject agent-mode reminders.
 * When max steps is reached, injects a max-steps reminder into the last user message.
 */
export function prepareMessages(
  session: SessionContext,
  agent: AgentProfile,
  currentStep: number,
  maxSteps: number,
): Message[] {
  let messages = insertReminders(
    session.timeline.messages,
    agent.id,
    session.previousAgentId,
  );

  const maxStepsReached = currentStep >= maxSteps;
  if (maxStepsReached && messages.length > 0) {
    messages = injectMaxStepsReminder(messages);
  }

  return messages;
}

function injectMaxStepsReminder(messages: Message[]): Message[] {
  const result = [...messages];
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].role === 'user') {
      result[i] = {
        ...result[i],
        parts: [
          ...result[i].parts,
          {
            type: 'text' as const,
            id: `max_steps_${Date.now()}`,
            index: result[i].parts.length,
            text: MAX_STEPS_REMINDER,
            synthetic: true,
          },
        ],
      };
      break;
    }
  }
  return result;
}

export { buildTaskReminder };

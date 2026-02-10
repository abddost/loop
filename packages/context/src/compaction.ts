/**
 * Context compaction -- summarizes older history using the summarize agent.
 */

import type { Message, TextPart } from '@coding-assistant/shared';
import { generateMessageId, generatePartId } from '@coding-assistant/shared';
import { estimateTokenCount } from './budget.js';

/**
 * Prepare messages for compaction.
 * Returns the messages to summarize and the messages to keep.
 */
export function prepareCompaction(
  messages: readonly Message[],
  keepRecentCount: number = 10,
): { toSummarize: Message[]; toKeep: Message[] } {
  if (messages.length <= keepRecentCount) {
    return { toSummarize: [], toKeep: [...messages] };
  }

  const splitPoint = messages.length - keepRecentCount;
  return {
    toSummarize: messages.slice(0, splitPoint) as Message[],
    toKeep: messages.slice(splitPoint) as Message[],
  };
}

/**
 * Create a summary message to replace compacted messages.
 */
export function createSummaryMessage(
  sessionId: string,
  summaryText: string,
  originalCount: number,
  originalTokens: number,
): Message {
  const textPart: TextPart = {
    type: 'text',
    id: generatePartId(),
    index: 0,
    text: `[Conversation summary - ${originalCount} messages compacted]\n\n${summaryText}`,
  };

  return {
    id: generateMessageId(),
    sessionId,
    role: 'assistant',
    index: 0,
    modelId: null,
    finishReason: 'stop',
    usage: null,
    error: null,
    parts: [textPart],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Build the compaction prompt for the summarize agent.
 */
export function buildCompactionPrompt(messages: readonly Message[]): string {
  const parts: string[] = [
    'Summarize the following conversation history. Preserve:',
    '- Key decisions and their reasoning',
    '- Important file changes and modifications',
    '- Active tasks and todos',
    '- Error resolutions',
    '',
    'Conversation:',
    '',
  ];

  for (const msg of messages) {
    parts.push(`[${msg.role}]:`);
    for (const part of msg.parts) {
      if (part.type === 'text') {
        parts.push(part.text.slice(0, 500));
      } else if (part.type === 'tool-call') {
        parts.push(`  Tool: ${part.toolName}(${JSON.stringify(part.args).slice(0, 200)})`);
      } else if (part.type === 'tool-result') {
        const result = typeof part.result === 'string'
          ? part.result.slice(0, 200)
          : JSON.stringify(part.result).slice(0, 200);
        parts.push(`  Result: ${result}`);
      }
    }
    parts.push('');
  }

  return parts.join('\n');
}

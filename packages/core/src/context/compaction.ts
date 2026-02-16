/**
 * Context compaction -- summarizes older history using the summarize agent.
 *
 * Works alongside tool-output-pruning.ts (lightweight) and pruning.ts (turn-level).
 * This module provides the "heavyweight" compaction: an LLM generates a narrative
 * summary of older messages, which replaces them as a single summary message.
 *
 * Summary messages are marked with `summary: true` which acts as a boundary
 * sentinel -- both turn-level pruning and tool-output pruning stop when they
 * encounter a summary message.
 */

import type { Message, TextPart, ToolResultPart } from '@coding-assistant/shared';
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
 *
 * The `summary: true` flag marks this as a compaction boundary.
 * Pruning algorithms (both turn-level and tool-output) will stop
 * when they encounter a summary message.
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
    summary: true,
  };
}

/**
 * Build the compaction prompt for the summarize agent.
 *
 * Focuses on continuation context (modeled after OpenCode's compaction prompt):
 * what was done, what's being worked on, files being modified, what's next,
 * key preferences, and technical decisions.
 *
 * Handles compacted tool-result parts gracefully (shows placeholder).
 */
export function buildCompactionPrompt(messages: readonly Message[]): string {
  const parts: string[] = [
    'Summarize the conversation so far. Focus on information needed to continue working:',
    '',
    '- What has been accomplished (key changes, files modified, decisions made)',
    '- What is currently being worked on',
    '- Which files are being modified and their current state',
    '- What needs to be done next',
    '- Key user requests, constraints, or preferences that must persist',
    '- Important technical decisions and why they were made',
    '- Any active errors or issues being debugged',
    '',
    'Your summary replaces the original messages. It must be comprehensive enough',
    'to provide full context but concise enough to be quickly understood.',
    '',
    'Conversation history:',
    '',
  ];

  for (const msg of messages) {
    parts.push(`[${msg.role}]:`);
    for (const part of msg.parts) {
      if (part.type === 'text') {
        parts.push(part.text.slice(0, 1000));
      } else if (part.type === 'tool-call') {
        parts.push(`  Tool: ${part.toolName}(${JSON.stringify(part.args).slice(0, 300)})`);
      } else if (part.type === 'tool-result') {
        const trPart = part as ToolResultPart;
        if (trPart.compacted) {
          parts.push(`  Result: [content previously cleared]`);
        } else {
          const result = typeof trPart.result === 'string'
            ? trPart.result.slice(0, 300)
            : JSON.stringify(trPart.result).slice(0, 300);
          parts.push(`  Result: ${result}`);
        }
      }
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Message Builder -- converts MessageTimeline to AI SDK CoreMessage[] format.
 *
 * The AI SDK expects:
 *  - { role: 'user', content: string | UserContent[] }
 *  - { role: 'assistant', content: AssistantContent[] }
 *  - { role: 'tool', content: ToolContent[] }
 *
 * Our internal Message format uses a flat parts array per message.
 * This module bridges the two representations.
 */

import type { Message, MessagePart } from '@coding-assistant/shared';
import type { MessageTimeline } from '../session/timeline.js';

// ── AI SDK Core Message types (minimal, matching ai package) ──────────────

export interface CoreUserMessage {
  role: 'user';
  content: string;
}

export interface CoreAssistantMessage {
  role: 'assistant';
  content: CoreAssistantContentPart[];
}

export interface CoreToolMessage {
  role: 'tool';
  content: CoreToolResultPart[];
}

export type CoreMessage = CoreUserMessage | CoreAssistantMessage | CoreToolMessage;

export interface CoreTextPart {
  type: 'text';
  text: string;
}

export interface CoreToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export type CoreAssistantContentPart = CoreTextPart | CoreToolCallPart;

export interface CoreToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

// ── Builder ───────────────────────────────────────────────────────────────

/**
 * Convert a MessageTimeline (or raw Message array) into AI SDK CoreMessage[].
 *
 * Rules:
 *  - User messages -> combine text parts into a single content string.
 *  - Assistant messages -> map text parts to CoreTextPart, tool-call parts to CoreToolCallPart.
 *  - Tool-result parts on ANY message are collected into a role:'tool' message
 *    that immediately follows the assistant message containing the matching tool-call.
 */
export function buildMessagesForAI(timeline: MessageTimeline): CoreMessage[] {
  return convertMessages(timeline.messages);
}

export function convertMessages(messages: readonly Message[]): CoreMessage[] {
  const result: CoreMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = extractText(msg.parts);
      if (text) {
        result.push({ role: 'user', content: text });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const assistantParts = buildAssistantParts(msg.parts);
      const toolResults = buildToolResults(msg.parts);

      if (assistantParts.length > 0) {
        result.push({ role: 'assistant', content: assistantParts });
      }

      // Tool results follow the assistant message as a separate role:'tool' message
      if (toolResults.length > 0) {
        result.push({ role: 'tool', content: toolResults });
      }
      continue;
    }

    // role === 'tool' messages (if they exist standalone)
    if (msg.role === 'tool') {
      const toolResults = buildToolResults(msg.parts);
      if (toolResults.length > 0) {
        result.push({ role: 'tool', content: toolResults });
      }
    }
  }

  return result;
}

/**
 * Extract all text from a parts array, joining with newlines.
 */
function extractText(parts: readonly MessagePart[]): string {
  return parts
    .filter((p): p is MessagePart & { type: 'text' } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

/**
 * Build assistant content parts (text + tool-calls) from our internal parts.
 * Filters out error parts, step markers, reasoning (not sent to model).
 */
function buildAssistantParts(parts: readonly MessagePart[]): CoreAssistantContentPart[] {
  const result: CoreAssistantContentPart[] = [];

  for (const part of parts) {
    switch (part.type) {
      case 'text':
        if (part.text.trim()) {
          result.push({ type: 'text', text: part.text });
        }
        break;
      case 'tool-call':
        result.push({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.args,
        });
        break;
      // Skip: reasoning, source, file, step markers, error parts
    }
  }

  return result;
}

/**
 * Extract tool-result parts from our internal message parts.
 */
function buildToolResults(parts: readonly MessagePart[]): CoreToolResultPart[] {
  return parts
    .filter((p): p is MessagePart & { type: 'tool-result' } => p.type === 'tool-result')
    .map((p) => ({
      type: 'tool-result' as const,
      toolCallId: p.toolCallId,
      toolName: p.toolName,
      result: p.result,
      isError: p.isError || undefined,
    }));
}

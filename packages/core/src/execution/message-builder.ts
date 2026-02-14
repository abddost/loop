/**
 * Message Builder -- converts MessageTimeline to AI SDK ModelMessage[] format.
 *
 * The AI SDK v6 expects:
 *  - { role: 'user', content: string | UserContent[] }
 *  - { role: 'assistant', content: AssistantContent[] }
 *  - { role: 'tool', content: ToolContent[] }
 *
 * Our internal Message format uses a flat parts array per message.
 * This module bridges the two representations.
 *
 * Note: We define local structural types that match the AI SDK v6 shapes.
 * This avoids a direct import dependency while staying compatible.
 */

import type { Message, MessagePart } from '@coding-assistant/shared';
import type { MessageTimeline } from '../session/timeline.js';

// ── AI SDK v6 ModelMessage types (structural match, no runtime import) ────

export interface UserModelMsg {
  role: 'user';
  content: string;
}

export interface AssistantModelMsg {
  role: 'assistant';
  content: AssistantContentPart[];
}

export interface ToolModelMsg {
  role: 'tool';
  content: ToolResultContentPart[];
}

export type ModelMsg = UserModelMsg | AssistantModelMsg | ToolModelMsg;

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ToolCallContentPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  /** v6: renamed from 'args' to 'input' */
  input: Record<string, unknown>;
}

export type AssistantContentPart = TextContentPart | ToolCallContentPart;

export interface ToolResultContentPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  /** v6: renamed from 'result' to 'output' */
  output: unknown;
}

// ── Builder ───────────────────────────────────────────────────────────────

/**
 * Convert a MessageTimeline (or raw Message array) into AI SDK v6 ModelMessage[].
 *
 * Rules:
 *  - User messages -> combine text parts into a single content string.
 *  - Assistant messages -> map text parts to TextContentPart, tool-call parts to ToolCallContentPart.
 *  - Tool-result parts on ANY message are collected into a role:'tool' message
 *    that immediately follows the assistant message containing the matching tool-call.
 */
export function buildMessagesForAI(timeline: MessageTimeline): ModelMsg[] {
  return convertMessages(timeline.messages);
}

export function convertMessages(messages: readonly Message[]): ModelMsg[] {
  const result: ModelMsg[] = [];

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
function buildAssistantParts(parts: readonly MessagePart[]): AssistantContentPart[] {
  const result: AssistantContentPart[] = [];

  for (const part of parts) {
    switch (part.type) {
      case 'text':
        if (part.text.trim()) {
          result.push({ type: 'text', text: part.text });
        }
        break;
      case 'tool-call':
        // v6: internal 'args' maps to AI SDK 'input'
        result.push({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.args,
        });
        break;
      // Skip: reasoning, source, file, step markers, error parts
    }
  }

  return result;
}

/**
 * Extract tool-result parts from our internal message parts.
 * Respects the `compacted` flag -- compacted results use the placeholder text.
 */
function buildToolResults(parts: readonly MessagePart[]): ToolResultContentPart[] {
  return parts
    .filter((p): p is MessagePart & { type: 'tool-result' } => p.type === 'tool-result')
    .map((p) => ({
      type: 'tool-result' as const,
      toolCallId: p.toolCallId,
      toolName: p.toolName,
      // v6: internal 'result' maps to AI SDK 'output'
      // Compacted results have already been replaced with a placeholder string
      output: p.compacted ? '[Old tool result content cleared]' : p.result,
    }));
}

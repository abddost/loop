/**
 * ToolCallCard -- routing component that delegates to the appropriate
 * tool visualization based on tool type.
 *
 * - Read/simple tools -> SimpleToolLine
 * - File-change tools -> FileChangeCard
 * - Bash -> BashCard
 *
 * Wrapped in React.memo to skip re-renders when tool state hasn't changed.
 */

import React, { memo } from 'react';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { SimpleToolLine } from './tools/SimpleToolLine';
import { FileChangeCard } from './tools/FileChangeCard';
import { BashCard } from './tools/BashCard';
import { SubagentCard } from './tools/SubagentCard';
import { TodoCard } from './tools/TodoCard';
import { isSimpleTextTool, BASH_TOOL, getToolRunning, getToolError } from './tools/tool-utils';
import type { ToolCallPart, ToolResultPart } from '../types';

const SUBAGENT_TOOL = 'subagent';
const TODO_TOOLS = new Set(['todo-read', 'todo-write']);

export interface ToolCallCardProps {
  part: ToolCallPart;
  /**
   * True when the tool is still executing.
   * Prefer reading part.status directly when available;
   * falls back to this prop for backward compatibility.
   */
  isRunning: boolean;
  /** The matching tool-result part, if available */
  result?: ToolResultPart;
}

export const ToolCallCard = memo(function ToolCallCard({ part, isRunning, result }: ToolCallCardProps) {
  const running = getToolRunning(part, isRunning);
  const errored = getToolError(part);
  const durationMs = result?.durationMs;
  const compacted = result?.compacted === true;

  let card: React.ReactElement;
  if (part.toolName === SUBAGENT_TOOL) {
    card = <SubagentCard part={part} isRunning={running} isError={errored} result={result} />;
  } else if (TODO_TOOLS.has(part.toolName)) {
    card = <TodoCard part={part} isRunning={running} isError={errored} result={result} />;
  } else if (isSimpleTextTool(part.toolName)) {
    card = <SimpleToolLine part={part} isRunning={running} isError={errored} durationMs={durationMs} />;
  } else if (part.toolName === BASH_TOOL) {
    card = <BashCard part={part} isRunning={running} isError={errored} result={result} />;
  } else {
    card = <FileChangeCard part={part} isRunning={running} isError={errored} durationMs={durationMs} />;
  }

  if (compacted) {
    return (
      <div className="flex items-center gap-1.5">
        {card}
        <Badge color="secondary" variant="soft" size="sm">pruned</Badge>
      </div>
    );
  }

  return card;
});

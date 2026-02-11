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

import { memo } from 'react';
import { SimpleToolLine } from './tools/SimpleToolLine';
import { FileChangeCard } from './tools/FileChangeCard';
import { BashCard } from './tools/BashCard';
import { isSimpleTextTool, BASH_TOOL, getToolRunning, getToolError } from './tools/tool-utils';
import type { ToolCallPart, ToolResultPart } from '../types';

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

  if (isSimpleTextTool(part.toolName)) {
    return <SimpleToolLine part={part} isRunning={running} isError={errored} />;
  }
  if (part.toolName === BASH_TOOL) {
    return <BashCard part={part} isRunning={running} isError={errored} result={result} />;
  }
  return <FileChangeCard part={part} isRunning={running} isError={errored} />;
});

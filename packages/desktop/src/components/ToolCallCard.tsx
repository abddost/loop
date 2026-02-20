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

import React, { memo, useMemo } from 'react';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { unwrapToolResult } from '@coding-assistant/shared';
import { SimpleToolLine } from './tools/SimpleToolLine';
import { FileChangeCard } from './tools/FileChangeCard';
import { BashCard } from './tools/BashCard';
import { SubagentCard } from './tools/SubagentCard';
import { TodoCard } from './tools/TodoCard';
import { PlanCard } from './tools/PlanCard';
import { isSimpleTextTool, BASH_TOOL, getToolRunning, getToolError } from './tools/tool-utils';
import type { ToolCallPart, ToolResultPart } from '../types';
import type { ChildSessionState } from '../store/reducers/subagent-reducers';

const SUBAGENT_TOOL = 'subagent';
const PLAN_SAVE_TOOL = 'plan-save';
const TASK_TOOLS = new Set(['todo-read', 'todo-write', 'task-read', 'task-write']);

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
  /** Workspace ID for plan save-to-workspace */
  workspaceId?: string;
  /** Callback to approve a plan and switch to build agent */
  onApproveAndBuild?: (planPath: string) => void;
  /** Whether the session is currently streaming */
  isStreaming?: boolean;
  /** Live child session state for subagent tool calls. */
  childSession?: ChildSessionState;
  /** True when the parent is streaming content after this tool call. */
  isParentStreamingOther?: boolean;
}

export const ToolCallCard = memo(function ToolCallCard({ part, isRunning, result, workspaceId, onApproveAndBuild, isStreaming, childSession, isParentStreamingOther }: ToolCallCardProps) {
  const running = getToolRunning(part, isRunning);
  const errored = getToolError(part);
  const durationMs = result?.durationMs;
  const compacted = result?.compacted === true;

  // Unwrap AI SDK envelope format { type: "json"|"text", value: ... }
  // which is present when results are loaded from DB, but not during streaming.
  const unwrappedResult = useMemo(() => {
    if (!result) return undefined;
    const raw = unwrapToolResult(result.output);
    if (raw === result.output) return result;
    return { ...result, output: raw };
  }, [result]);

  let card: React.ReactElement;
  if (part.toolName === SUBAGENT_TOOL) {
    card = <SubagentCard part={part} isRunning={running} isError={errored} result={unwrappedResult} childSession={childSession} isParentStreamingOther={isParentStreamingOther} />;
  } else if (part.toolName === PLAN_SAVE_TOOL) {
    card = <PlanCard part={part} isRunning={running} isError={errored} result={unwrappedResult} workspaceId={workspaceId ?? ''} onApproveAndBuild={onApproveAndBuild} isStreaming={isStreaming} />;
  } else if (TASK_TOOLS.has(part.toolName)) {
    card = <TodoCard part={part} isRunning={running} isError={errored} result={unwrappedResult} />;
  } else if (isSimpleTextTool(part.toolName)) {
    card = <SimpleToolLine part={part} isRunning={running} isError={errored} durationMs={durationMs} />;
  } else if (part.toolName === BASH_TOOL) {
    card = <BashCard part={part} isRunning={running} isError={errored} result={unwrappedResult} />;
  } else {
    card = <FileChangeCard part={part} result={unwrappedResult} isRunning={running} isError={errored} durationMs={durationMs} />;
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

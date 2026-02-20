/**
 * SubagentCard -- live streaming card for subagent tool calls.
 *
 * Shows agent type badge, description, and an expandable/collapsible
 * mini-chat that renders child parts (text, reasoning, tool-calls, tool-results)
 * streamed from the subagent's execution in real-time.
 *
 * Auto-expand/collapse rules:
 * - Auto-opens when the subagent starts running
 * - Auto-collapses when the parent is streaming other content after this tool call
 * - User click overrides auto behavior
 * - User override resets when a new subagent run starts
 */

import { useState, useEffect, useRef, memo } from 'react';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import { Markdown } from '@openai/apps-sdk-ui/components/Markdown';
import { ChevronUp, Spin } from '@openai/apps-sdk-ui/components/Icon';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import type { ToolCallPart, ToolResultPart } from '../../types';
import type { ChildSessionState, ChildPart } from '../../store/reducers/subagent-reducers';

interface SubagentCardProps {
  part: ToolCallPart;
  isRunning: boolean;
  isError: boolean;
  result?: ToolResultPart;
  /** Live child state from the event store. */
  childSession?: ChildSessionState;
  /** True when the parent is generating content after this tool call. */
  isParentStreamingOther?: boolean;
}

export const SubagentCard = memo(function SubagentCard({
  part,
  isRunning,
  isError,
  result,
  childSession,
  isParentStreamingOther,
}: SubagentCardProps) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const wasRunningRef = useRef(false);

  const agentType = String(part.args?.agentType ?? 'agent');
  const description = String(part.args?.description ?? '');
  const isChildRunning = childSession?.status === 'running';
  const isCompleted = childSession?.status === 'completed' || !!result;

  // Auto-open/close logic:
  // - Opens when subagent starts (isChildRunning becomes true)
  // - Collapses when parent streams other content (isParentStreamingOther)
  // - User toggle overrides auto behavior
  const autoExpanded = isChildRunning && !isParentStreamingOther;
  const expanded = userToggled !== null ? userToggled : autoExpanded;

  // Reset userToggle when subagent starts (so auto logic takes over)
  useEffect(() => {
    if (isChildRunning && !wasRunningRef.current) {
      setUserToggled(null);
    }
    wasRunningRef.current = !!isChildRunning;
  }, [isChildRunning]);

  const durationMs = childSession?.durationMs ?? result?.durationMs;
  const durationStr = durationMs != null
    ? durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
    : undefined;

  // Fallback output for when we don't have child session parts (e.g., historical messages)
  const fallbackOutput = result
    ? typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output, null, 2)
    : '';

  return (
    <div className="mt-3 rounded-xl border border-default bg-surface overflow-hidden">
      {/* Header / trigger */}
      <button
        onClick={() => setUserToggled((prev) => (prev === null ? !autoExpanded : !prev))}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-surface-secondary/60 transition-colors text-left"
      >
        {isChildRunning && <Spin className="size-3.5 text-info animate-spin shrink-0" />}
        <Badge color={agentType === 'explore' ? 'info' : 'success'} variant="soft" size="sm">
          {agentType}
        </Badge>

        {isRunning || isChildRunning ? (
          <ShimmerableText shimmer className="text-xs text-secondary truncate flex-1">
            {description || 'Running subagent...'}
          </ShimmerableText>
        ) : (
          <span className="text-xs text-secondary truncate flex-1">
            {description || 'Subagent'}
          </span>
        )}

        {isError && <span className="text-[10px] text-red-400 shrink-0">error</span>}
        {isCompleted && !isError && durationStr && (
          <Tooltip content={`${durationMs}ms`}>
            <span className="text-[10px] text-tertiary shrink-0">{durationStr}</span>
          </Tooltip>
        )}

        <ChevronUp
          className={`size-3.5 text-tertiary transition-transform duration-200 shrink-0 ${
            expanded ? '' : 'rotate-180'
          }`}
        />
      </button>

      {/* Expandable content: live streaming mini-chat */}
      {expanded && (
        <div className="border-t border-subtle max-h-96 overflow-y-auto">
          <div className="px-4 py-3 space-y-1.5">
            {childSession?.parts.map((childPart, i) => (
              <ChildPartRenderer key={i} part={childPart} />
            ))}

            {/* Fallback: show result text if no child parts available */}
            {!childSession?.parts.length && fallbackOutput && (
              <div className="prose prose-sm max-w-none text-default text-xs">
                <Markdown
                  includeMath={false}
                  breakNewLines={false}
                  copyableCodeBlocks={true}
                  skipHtml={false}
                >
                  {fallbackOutput}
                </Markdown>
              </div>
            )}

            {/* Loading indicator */}
            {isChildRunning && !childSession?.parts.length && !fallbackOutput && (
              <div className="flex items-center gap-2 text-tertiary text-xs py-1">
                <Spin className="size-3 animate-spin" /> Thinking...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

/** Renders a single child part (text, reasoning, tool-call, tool-result). */
const ChildPartRenderer = memo(function ChildPartRenderer({ part }: { part: ChildPart }) {
  switch (part.type) {
    case 'text':
      return (
        <div className="prose prose-sm max-w-none text-default text-xs">
          <Markdown
            includeMath={false}
            breakNewLines={false}
            copyableCodeBlocks={true}
            skipHtml={false}
          >
            {part.text}
          </Markdown>
        </div>
      );

    case 'reasoning':
      return (
        <details>
          <summary className="flex items-center gap-1 text-[10px] text-tertiary cursor-pointer select-none">
            <svg
              className="size-2.5 transition-transform group-open:rotate-90"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Thinking
          </summary>
          <div className="pl-3 text-[10px] text-tertiary whitespace-pre-wrap leading-relaxed">
            {part.text}
          </div>
        </details>
      );

    case 'tool-call': {
      const isToolRunning = part.status === 'running' || part.status === 'pending';
      const label = getChildToolLabel(part.toolName, part.args);
      return (
        <div className="flex items-center gap-1.5 text-[10px] text-tertiary py-0.5">
          {isToolRunning ? (
            <>
              <Spin className="size-2.5 animate-spin shrink-0" />
              <ShimmerableText shimmer className="truncate">
                {label}
              </ShimmerableText>
            </>
          ) : (
            <span className="truncate">{label}</span>
          )}
        </div>
      );
    }

    case 'tool-result':
      // Show inline output only for bash (truncated)
      if (part.toolName === 'bash' && typeof part.output === 'string' && (part.output as string).length > 0) {
        return (
          <pre className="text-[10px] text-tertiary font-mono whitespace-pre-wrap max-h-24 overflow-y-auto rounded bg-surface-secondary/50 px-2 py-1">
            {(part.output as string).slice(0, 500)}
          </pre>
        );
      }
      return null;

    case 'error':
      return (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1.5 text-[10px] text-red-400">
          {part.message}
        </div>
      );

    default:
      return null;
  }
});

function getChildToolLabel(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'file-read':
      return `Read ${args.path ?? ''}`;
    case 'file-write':
      return `Write ${args.path ?? ''}`;
    case 'file-edit':
      return `Edit ${args.path ?? ''}`;
    case 'glob':
      return `Glob ${args.pattern ?? ''}`;
    case 'grep':
      return `Grep ${args.pattern ?? ''}`;
    case 'bash':
      return `$ ${String(args.command ?? '').slice(0, 60)}`;
    case 'web-search':
      return `Search: ${args.query ?? ''}`;
    default:
      return toolName;
  }
}

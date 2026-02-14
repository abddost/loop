/**
 * SubagentCard -- card for subagent tool calls showing agent type, description, and expandable result.
 */

import { useState, memo } from 'react';
import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Markdown } from '@openai/apps-sdk-ui/components/Markdown';
import { ChevronUp } from '@openai/apps-sdk-ui/components/Icon';
import type { ToolCallPart, ToolResultPart } from '../../types';

interface SubagentCardProps {
  part: ToolCallPart;
  isRunning: boolean;
  isError: boolean;
  result?: ToolResultPart;
}

export const SubagentCard = memo(function SubagentCard({ part, isRunning, isError, result }: SubagentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const agentType = String(part.args?.agent ?? part.args?.agentType ?? 'agent');
  const description = String(part.args?.description ?? part.args?.task ?? '');
  const output = result
    ? typeof result.result === 'string'
      ? result.result
      : JSON.stringify(result.result, null, 2)
    : '';
  const durationMs = result?.durationMs;

  return (
    <div className="mt-3 rounded-xl border border-default bg-surface overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-surface-secondary/60 transition-colors text-left"
      >
        <Badge color="info" variant="soft" size="sm">{agentType}</Badge>
        {isRunning ? (
          <ShimmerableText shimmer className="text-xs text-secondary truncate flex-1">
            {description || 'Running subagent...'}
          </ShimmerableText>
        ) : (
          <span className="text-xs text-secondary truncate flex-1">
            {description || 'Subagent'}
          </span>
        )}
        {isError && (
          <span className="text-[10px] text-red-400 shrink-0">error</span>
        )}
        {!isRunning && !isError && durationMs != null && (
          <span className="text-[10px] text-tertiary shrink-0">
            {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        <ChevronUp
          className={`size-3.5 text-tertiary transition-transform duration-200 shrink-0 ${
            expanded ? '' : 'rotate-180'
          }`}
        />
      </button>

      {expanded && output && (
        <div className="border-t border-subtle px-4 py-3 max-h-64 overflow-y-auto prose prose-sm max-w-none text-default">
          <Markdown
            includeMath={false}
            breakNewLines={false}
            copyableCodeBlocks={true}
            skipHtml={false}
          >
            {output}
          </Markdown>
        </div>
      )}
    </div>
  );
});

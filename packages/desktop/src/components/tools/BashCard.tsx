/**
 * BashCard -- card showing the bash command with expandable output accordion.
 */

import { useState } from 'react';
import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import { Animate } from '@openai/apps-sdk-ui/components/Transition';
import { ChevronUp, Terminal } from '@openai/apps-sdk-ui/components/Icon';
import { MAX_BASH_OUTPUT_CHARS, MAX_COMMAND_DISPLAY_LENGTH } from '../../constants';
import type { ToolCallPart, ToolResultPart } from '../../types';

interface BashCardProps {
  part: ToolCallPart;
  isRunning: boolean;
  isError: boolean;
  result?: ToolResultPart;
}

export function BashCard({ part, isRunning, isError, result }: BashCardProps) {
  const [expanded, setExpanded] = useState(false);
  const command = String(part.args?.command ?? '');
  const truncatedCmd =
    command.length > MAX_COMMAND_DISPLAY_LENGTH
      ? command.slice(0, MAX_COMMAND_DISPLAY_LENGTH) + '\u2026'
      : command;
  const output = result
    ? typeof result.result === 'string'
      ? result.result
      : JSON.stringify(result.result, null, 2)
    : '';

  return (
    <Animate
      enter={{ opacity: 1, y: 0, duration: 300 }}
      initial={{ opacity: 0, y: 6 }}
    >
      <div key={part.id} className="mt-3 rounded-xl border border-default bg-surface overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-surface-secondary/60 transition-colors text-left"
        >
          <Terminal className="size-3.5 text-tertiary shrink-0" />
          {isRunning ? (
            <ShimmerableText shimmer className="text-xs font-mono text-secondary truncate flex-1">
              $ {truncatedCmd}
            </ShimmerableText>
          ) : (
            <span className="text-xs font-mono text-secondary truncate flex-1">
              $ {truncatedCmd}
            </span>
          )}
          {result?.isError && (
            <span className="text-[10px] text-red-400 shrink-0">error</span>
          )}
          <ChevronUp
            className={`size-3.5 text-tertiary transition-transform duration-200 shrink-0 ${
              expanded ? '' : 'rotate-180'
            }`}
          />
        </button>

        {expanded && output && (
          <div className="border-t border-subtle px-4 py-3 max-h-64 overflow-y-auto">
            <pre className="text-[11px] text-secondary font-mono whitespace-pre-wrap">
              {output.slice(0, MAX_BASH_OUTPUT_CHARS)}
            </pre>
          </div>
        )}
      </div>
    </Animate>
  );
}

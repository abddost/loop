/**
 * BashCard — enhanced card with status indicators, streaming output,
 * exit code badge, duration display, and ANSI stripping.
 */

import { useState, useMemo, memo } from 'react';
import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { ChevronUp, Terminal } from '@openai/apps-sdk-ui/components/Icon';
import { MAX_BASH_OUTPUT_CHARS, MAX_COMMAND_DISPLAY_LENGTH } from '../../constants';
import type { ToolCallPart, ToolResultPart } from '../../types';

interface BashCardProps {
  part: ToolCallPart;
  isRunning: boolean;
  isError: boolean;
  result?: ToolResultPart;
}

/** Strip ANSI escape codes (CSI sequences, OSC sequences, charset switches). */
function stripAnsi(str: string): string {
  return str
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1B\].*?\x07/g, '')
    .replace(/\x1B\(B/g, '');
}

function extractBashResult(result: unknown): { output: string; exitCode?: number; exitReason?: string } {
  if (!result) return { output: '' };
  if (typeof result === 'string') return { output: result };
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    const stdout = String(r.stdout ?? '');
    const stderr = String(r.stderr ?? '');
    const output = stdout + (stderr ? '\n--- stderr ---\n' + stderr : '');
    return {
      output,
      exitCode: typeof r.exitCode === 'number' ? r.exitCode : undefined,
      exitReason: typeof r.exitReason === 'string' ? r.exitReason : undefined,
    };
  }
  return { output: JSON.stringify(result, null, 2) };
}

/** Format milliseconds as a human-readable duration string. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Render the status indicator based on tool state. */
function StatusIndicator({ isRunning, exitCode, exitReason }: {
  isRunning: boolean;
  exitCode?: number;
  exitReason?: string;
}) {
  if (isRunning) return null; // shimmer text handles running state

  if (exitReason === 'timeout') {
    return <span className="text-[10px] text-yellow-400 shrink-0" title="Timed out">⏱</span>;
  }
  if (exitReason === 'killed') {
    return <span className="text-[10px] text-orange-400 shrink-0" title="Killed">⊘</span>;
  }
  if (exitCode !== undefined && exitCode !== 0) {
    return <span className="text-[10px] text-red-400 shrink-0" title={`Exit code ${exitCode}`}>✗</span>;
  }
  if (exitCode === 0) {
    return <span className="text-[10px] text-green-400 shrink-0" title="Success">✓</span>;
  }
  return null;
}

export const BashCard = memo(function BashCard({ part, isRunning, isError, result }: BashCardProps) {
  const [expanded, setExpanded] = useState(false);
  const command = String(part.args?.command ?? '');
  const description = part.args?.description ? String(part.args.description) : undefined;
  const truncatedCmd =
    command.length > MAX_COMMAND_DISPLAY_LENGTH
      ? command.slice(0, MAX_COMMAND_DISPLAY_LENGTH) + '\u2026'
      : command;

  const { output, exitCode, exitReason } = useMemo(() => {
    if (!result) return { output: '', exitCode: undefined, exitReason: undefined };
    return extractBashResult(result.output);
  }, [result]);

  const cleanOutput = useMemo(() => stripAnsi(output), [output]);

  const durationMs = result && 'durationMs' in result ? (result as { durationMs?: number }).durationMs : undefined;

  return (
    <div className="mt-3 rounded-xl border border-default bg-surface overflow-hidden">
      <Tooltip content={expanded ? 'Collapse output' : 'Expand output'} compact gutterSize="sm" contentClassName="text-xs">
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
        {durationMs !== undefined && (
          <span className="text-[10px] text-tertiary shrink-0">{formatDuration(durationMs)}</span>
        )}
        <StatusIndicator isRunning={isRunning} exitCode={exitCode} exitReason={exitReason} />
        {exitCode !== undefined && exitCode !== 0 && (
          <span className="text-[10px] font-mono text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded shrink-0">
            exit {exitCode}
          </span>
        )}
        {isError && exitCode === undefined && (
          <span className="text-[10px] text-red-400 shrink-0">error</span>
        )}
        <ChevronUp
          className={`size-3.5 text-tertiary transition-transform duration-200 shrink-0 ${
            expanded ? '' : 'rotate-180'
          }`}
        />
        </button>
      </Tooltip>

      {description && (
        <div className="px-4 pb-1 -mt-1">
          <span className="text-[10px] text-tertiary">{description}</span>
        </div>
      )}

      {expanded && cleanOutput && (
        <div className="border-t border-subtle px-4 py-3 max-h-64 overflow-y-auto">
          <pre className="text-[11px] text-secondary font-mono whitespace-pre-wrap">
            {cleanOutput.slice(0, MAX_BASH_OUTPUT_CHARS)}
          </pre>
        </div>
      )}
    </div>
  );
});

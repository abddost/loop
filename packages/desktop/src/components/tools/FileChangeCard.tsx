/**
 * FileChangeCard -- card with accordion header showing file change
 * summary and expandable diff view for file-write/file-edit/file-patch tools.
 *
 * Reads the actual unified diff from `result.output` (the tool's execution
 * output) when available, and falls back to reconstructing a diff from
 * `part.args` (tool input arguments) while the tool is still running.
 */

import { useState, useMemo, memo } from 'react';
import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { ChevronUp } from '@openai/apps-sdk-ui/components/Icon';
import { DiffView } from './DiffView';
import { DiffChanges } from './DiffChanges';
import { extractFileInfoFromResult, parseDiffFromResult, computeDiffLines } from './tool-utils';
import type { ToolCallPart, ToolResultPart } from '../../types';

interface FileChangeCardProps {
  part: ToolCallPart;
  /** The matching tool-result part (after envelope unwrapping). */
  result?: ToolResultPart;
  isRunning: boolean;
  isError: boolean;
  durationMs?: number;
}

/** Format milliseconds as a human-readable duration string. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Check if the result output indicates a newly created file with no diff. */
function isNewFileCreationMessage(result?: ToolResultPart): boolean {
  if (!result) return false;
  const raw = result.output;
  return typeof raw === 'string' && raw.startsWith('Created ');
}

/** Check if the result output indicates a binary file overwrite warning. */
function isBinaryOverwriteMessage(result?: ToolResultPart): boolean {
  if (!result) return false;
  const raw = result.output;
  return typeof raw === 'string' && raw.startsWith('Warning: Overwriting');
}

export const FileChangeCard = memo(function FileChangeCard({
  part,
  result,
  isRunning,
  isError,
  durationMs,
}: FileChangeCardProps) {
  const [expanded, setExpanded] = useState(false);

  // --- Derive file info (path + accurate addition/deletion counts) ---------
  // Uses the actual diff from result when available, falls back to args.
  const { filePath, additions, deletions } = useMemo(
    () => extractFileInfoFromResult(part, result),
    [part, result],
  );

  // --- Derive diff lines ---------------------------------------------------
  // While running: reconstruct from args (streaming preview).
  // After completion: parse the real unified diff from result.output.
  const { lines: diffLines, truncated } = useMemo(() => {
    if (isRunning) return { lines: computeDiffLines(part), truncated: false };
    return parseDiffFromResult(part, result);
  }, [part, result, isRunning]);

  // --- Edge case flags -----------------------------------------------------
  const compacted = result?.compacted === true;
  const newFileMsg = isNewFileCreationMessage(result);
  const binaryMsg = isBinaryOverwriteMessage(result);

  // --- Error message extraction --------------------------------------------
  const errorMessage = useMemo(() => {
    if (!isError || !result) return null;
    const raw = result.output;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && raw !== null) {
      const r = raw as Record<string, unknown>;
      return String(r.message ?? r.error ?? JSON.stringify(raw));
    }
    return null;
  }, [isError, result]);

  return (
    <div className="mt-3 rounded-xl border border-default bg-surface overflow-hidden">
      {/* ─── Accordion header row ─────────────────────────────────────── */}
      <div className="px-3 p-1">
        <Tooltip content={expanded ? 'Collapse diff' : 'Expand diff'} compact gutterSize="sm" contentClassName="text-xs">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-secondary/60 transition-colors text-left"
          >
          {/* File path (shimmer while running) */}
          <span className="text-xs text-secondary truncate flex-1 font-mono">
            {isRunning ? (
              <ShimmerableText shimmer className="text-xs text-secondary truncate flex-1 font-mono">
                {filePath}
              </ShimmerableText>
            ) : (
              filePath
            )}
          </span>

          {/* Stats: new badge + additions/deletions + change bar */}
          <span className="flex items-center gap-1.5 text-[11px] font-mono shrink-0">
            {newFileMsg && !isRunning && (
              <span className="text-[10px] text-blue-400 font-sans">new</span>
            )}
            {additions > 0 && (
              <span className="text-green-500">+{additions}</span>
            )}
            {deletions > 0 && (
              <span className="text-red-500">-{deletions}</span>
            )}
            <DiffChanges additions={additions} deletions={deletions} />
          </span>

          {/* Duration (only shown after completion) */}
          {durationMs !== undefined && !isRunning && (
            <span className="text-[10px] text-tertiary shrink-0">{formatDuration(durationMs)}</span>
          )}

          {/* Status indicator */}
          {!isRunning && !isError && result && (
            <span className="text-[10px] text-green-400 shrink-0" title="Success">✓</span>
          )}
          {isError && (
            <span className="text-[10px] text-red-400 shrink-0" title="Error">✗</span>
          )}

          {/* Chevron */}
          <ChevronUp
            className={`size-3.5 text-tertiary transition-transform duration-200 ${
              expanded ? '' : 'rotate-180'
            }`}
          />
          </button>
        </Tooltip>
      </div>

      {/* ─── Accordion content (diff / messages) ─────────────────────── */}
      {expanded && (
        <div className="border-t border-subtle max-h-96 overflow-y-auto">
          {compacted ? (
            /* Result was pruned from context to save tokens */
            <div className="px-4 py-3 text-[11px] text-tertiary italic">
              Diff pruned from context
            </div>
          ) : isError && errorMessage ? (
            /* Tool execution error */
            <div className="px-4 py-3 text-[11px] text-red-400 font-mono whitespace-pre-wrap">
              {errorMessage}
            </div>
          ) : binaryMsg ? (
            /* Binary file overwrite */
            <div className="px-4 py-3 text-[11px] text-tertiary italic">
              Binary file overwritten
            </div>
          ) : diffLines.length > 0 ? (
            /* Actual diff content */
            <DiffView lines={diffLines} truncated={truncated} />
          ) : newFileMsg ? (
            /* New file with no diff available */
            <div className="px-4 py-3 text-[11px] text-tertiary italic">
              New file created
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});

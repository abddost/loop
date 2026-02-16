/**
 * FileChangeCard -- card with accordion header showing file change
 * summary and expandable diff view for file-write/file-edit/file-patch tools.
 */

import { useState, memo } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { ShimmerableText } from '@openai/apps-sdk-ui/components/ShimmerText';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { ChevronUp, Undo } from '@openai/apps-sdk-ui/components/Icon';
import { DiffView } from './DiffView';
import { extractFileInfo, computeDiffLines } from './tool-utils';
import type { ToolCallPart } from '../../types';

interface FileChangeCardProps {
  part: ToolCallPart;
  isRunning: boolean;
  isError: boolean;
  durationMs?: number;
}

export const FileChangeCard = memo(function FileChangeCard({ part, isRunning, isError, durationMs }: FileChangeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { filePath, additions, deletions } = extractFileInfo(part);
  const diffLines = computeDiffLines(part);

  return (
    <div className="mt-3 rounded-xl border border-default bg-surface overflow-hidden">
      {/* Summary header */}
      <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-secondary">
        {isRunning ? (
          <ShimmerableText shimmer className="text-tertiary">
            1 file changed
          </ShimmerableText>
        ) : (
          <span className="text-tertiary">1 file changed</span>
        )}
        {additions > 0 && (
          <span className="text-green-500 font-medium">+{additions}</span>
        )}
        {deletions > 0 && (
          <span className="text-red-500 font-medium">-{deletions}</span>
        )}
        {!isRunning && !isError && durationMs != null && (
          <Tooltip content={`Execution time: ${durationMs}ms`}>
            <span className="text-[10px] text-tertiary shrink-0">
              {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
            </span>
          </Tooltip>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          color="secondary"
          size="sm"
          className="text-xs! px-2! py-0.5! text-tertiary! gap-1!"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <Undo className="size-3" />
          Undo
        </Button>
      </div>

      {/* File entry row (accordion trigger) */}
      <div className="px-3 pb-2.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-secondary/60 transition-colors text-left"
        >
          <span className="text-xs text-secondary truncate flex-1 font-mono">
            {filePath}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-mono shrink-0">
            {additions > 0 && (
              <span className="text-green-500">+{additions}</span>
            )}
            {deletions > 0 && (
              <span className="text-red-500">-{deletions}</span>
            )}
          </span>
          <ChevronUp
            className={`size-3.5 text-tertiary transition-transform duration-200 ${
              expanded ? '' : 'rotate-180'
            }`}
          />
        </button>
      </div>

      {/* Diff view (accordion content) */}
      {expanded && diffLines.length > 0 && (
        <div className="border-t border-subtle max-h-96 overflow-y-auto">
          <DiffView lines={diffLines} />
        </div>
      )}
    </div>
  );
});

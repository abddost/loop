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
      {/* File entry row (accordion trigger) */}
      <div className="px-3 p-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-secondary/60 transition-colors text-left"
        >
          <span className="text-xs text-secondary truncate flex-1 font-mono">
          {isRunning ? (
          <ShimmerableText shimmer={isRunning} className="text-xs text-secondary truncate flex-1 font-mono">
            {filePath}
          </ShimmerableText>
            ) : (
              <span className="text-xs text-secondary truncate flex-1 font-mono">{filePath}</span>
            )}
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

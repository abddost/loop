/**
 * FilePatchSummary -- step-level summary of files changed.
 *
 * Shown after a step finishes, listing all files touched with
 * change-type indicators (added/modified/deleted).
 * Auto-collapses when file count exceeds FILE_PATCH_COLLAPSE_THRESHOLD.
 *
 * Uses @openai/apps-sdk-ui components: Badge for change-type pills,
 * Tooltip for full file paths, Animate for smooth expand/collapse.
 *
 * Wrapped in React.memo for efficient memoization with immutable store updates.
 */

import { useState, memo } from 'react';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { Animate } from '@openai/apps-sdk-ui/components/Transition';
import { ChevronUp, FileCode } from '@openai/apps-sdk-ui/components/Icon';
import { FILE_PATCH_COLLAPSE_THRESHOLD } from '../../constants';
import type { FilePatchPart } from '../../types';

interface FilePatchSummaryProps {
  part: FilePatchPart;
}

/** Maps change type to Badge color */
const CHANGE_BADGE: Record<
  'added' | 'modified' | 'deleted',
  { label: string; color: 'success' | 'warning' | 'danger' }
> = {
  added:    { label: 'A', color: 'success' },
  modified: { label: 'M', color: 'warning' },
  deleted:  { label: 'D', color: 'danger'  },
};

function shortPath(path: string): string {
  const parts = path.split('/');
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : path;
}

export const FilePatchSummary = memo(function FilePatchSummary({ part }: FilePatchSummaryProps) {
  const { files } = part;
  const [expanded, setExpanded] = useState(files.length <= FILE_PATCH_COLLAPSE_THRESHOLD);

  const addedCount = files.filter(f => f.change === 'added').length;
  const modifiedCount = files.filter(f => f.change === 'modified').length;
  const deletedCount = files.filter(f => f.change === 'deleted').length;

  return (
    <div className="mt-1 rounded-lg border border-subtle bg-surface-secondary/30 overflow-hidden">
      {/* Summary header / toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-tertiary hover:text-secondary transition-colors"
      >
        <FileCode className="size-3.5 shrink-0" />
        <span>
          {files.length} file{files.length !== 1 ? 's' : ''} changed
        </span>
        {addedCount > 0 && (
          <Badge color="success" variant="soft" size="sm" pill>+{addedCount}</Badge>
        )}
        {modifiedCount > 0 && (
          <Badge color="warning" variant="soft" size="sm" pill>~{modifiedCount}</Badge>
        )}
        {deletedCount > 0 && (
          <Badge color="danger" variant="soft" size="sm" pill>-{deletedCount}</Badge>
        )}
        <div className="flex-1" />
        <ChevronUp
          className={`size-3 text-tertiary transition-transform duration-200 ${
            expanded ? '' : 'rotate-180'
          }`}
        />
      </button>

      {/* File list (expanded with animation) */}
      <Animate
        as="div"
        enter={{ opacity: 1, duration: 150 }}
        initial={{ opacity: 0 }}
        transitionPosition="static"
      >
        {expanded && (
          <div key="file-list" className="px-3 pb-2 space-y-0.5">
            {files.map((file) => {
              const badge = CHANGE_BADGE[file.change];
              return (
                <Tooltip key={file.path} content={file.path}>
                  <div className="flex items-center gap-2 py-0.5 text-xs">
                    <Badge
                      color={badge.color}
                      variant="outline"
                      size="sm"
                      className="font-mono"
                    >
                      {badge.label}
                    </Badge>
                    <span className="text-secondary font-mono truncate">
                      {shortPath(file.path)}
                    </span>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        )}
      </Animate>
    </div>
  );
});

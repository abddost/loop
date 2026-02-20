/**
 * DiffView -- renders a list of diff lines with addition/deletion/context markers,
 * hunk separators for @@ boundaries, and a truncation indicator.
 */

import type { DiffLine } from './tool-utils';

interface DiffViewProps {
  lines: DiffLine[];
  /** When true, the diff was capped at MAX_DIFF_LINES and more lines exist. */
  truncated?: boolean;
}

export function DiffView({ lines, truncated }: DiffViewProps) {
  if (lines.length === 0) return null;

  return (
    <div className="font-mono text-[12px] leading-[22px] overflow-x-auto">
      {lines.map((line, i) => {
        // Hunk separator: lineNumber === 0 marks an @@ header boundary
        if (line.type === 'context' && line.lineNumber === 0) {
          return (
            <div key={i} className="flex bg-blue-500/5 border-y border-blue-500/10">
              <div className="w-0.5 shrink-0 bg-blue-400/40" />
              <span className="px-3 py-0.5 text-[11px] text-blue-400/70 select-none truncate">
                {line.content}
              </span>
            </div>
          );
        }

        // Row background color
        const bg =
          line.type === 'deletion'
            ? 'bg-red-500/10'
            : line.type === 'addition'
              ? 'bg-green-500/10'
              : ''; // context lines get no background

        // Left marker strip color
        const markerBg =
          line.type === 'deletion'
            ? 'bg-red-500'
            : line.type === 'addition'
              ? 'bg-green-500'
              : 'bg-transparent'; // context lines get no marker

        return (
          <div key={i} className={`flex ${bg}`}>
            {/* Color marker strip */}
            <div className={`w-0.5 shrink-0 ${markerBg}`} />
            {/* Line number */}
            <span className="w-12 text-right pr-3 text-tertiary/40 select-none shrink-0 tabular-nums">
              {line.lineNumber}
            </span>
            {/* Content */}
            <span className="flex-1 pr-4 whitespace-pre">
              {line.content || '\u00A0'}
            </span>
          </div>
        );
      })}

      {truncated && (
        <div className="flex items-center justify-center py-1.5 bg-surface-secondary/40 border-t border-subtle">
          <span className="text-[10px] text-tertiary">
            Showing first {lines.length} lines
          </span>
        </div>
      )}
    </div>
  );
}

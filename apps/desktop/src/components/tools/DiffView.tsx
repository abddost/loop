/**
 * DiffView -- renders a list of diff lines with addition/deletion markers.
 */

import type { DiffLine } from './tool-utils';

interface DiffViewProps {
  lines: DiffLine[];
}

export function DiffView({ lines }: DiffViewProps) {
  if (lines.length === 0) return null;

  return (
    <div className="font-mono text-[12px] leading-[22px] overflow-x-auto">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`flex ${
            line.type === 'deletion' ? 'bg-red-500/10' : 'bg-green-500/10'
          }`}
        >
          {/* Color marker strip */}
          <div
            className={`w-0.5 shrink-0 ${
              line.type === 'deletion' ? 'bg-red-500' : 'bg-green-500'
            }`}
          />
          {/* Line number */}
          <span className="w-12 text-right pr-3 text-tertiary/40 select-none shrink-0 tabular-nums">
            {line.lineNumber}
          </span>
          {/* Content */}
          <span className="flex-1 pr-4 whitespace-pre">
            {line.content || '\u00A0'}
          </span>
        </div>
      ))}
    </div>
  );
}

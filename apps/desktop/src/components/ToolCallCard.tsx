/**
 * ToolCallCard -- displays tool invocations as file-change-style cards.
 */

import { useState } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { ChevronDown, ChevronRight, FileDocument, Undo } from '@openai/apps-sdk-ui/components/Icon';
import type { ToolCallPart } from '@coding-assistant/shared';

interface ToolCallCardProps {
  part: ToolCallPart;
}

/**
 * Detect if a tool call is file-related and extract file info.
 */
function extractFileInfo(part: ToolCallPart): { isFileOp: boolean; filePath: string | null; additions: number; deletions: number } {
  const fileTools = ['file-write', 'file-edit', 'file-patch', 'file-read'];
  const isFileOp = fileTools.includes(part.toolName);
  const filePath = (part.args?.path as string) ?? (part.args?.filePath as string) ?? null;

  let additions = 0;
  let deletions = 0;
  if (part.toolName === 'file-write' && part.args?.content) {
    additions = String(part.args.content).split('\n').length;
  } else if (part.toolName === 'file-edit' || part.toolName === 'file-patch') {
    const newStr = part.args?.new_string ?? part.args?.newString ?? '';
    const oldStr = part.args?.old_string ?? part.args?.oldString ?? '';
    additions = String(newStr).split('\n').length;
    deletions = String(oldStr).split('\n').length;
  }

  return { isFileOp, filePath, additions, deletions };
}

export function ToolCallCard({ part }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { isFileOp, filePath, additions, deletions } = extractFileInfo(part);

  if (isFileOp && filePath) {
    return (
      <div className="mt-3 rounded-xl border border-default bg-surface overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-surface-secondary transition-colors"
        >
          {expanded ? (
            <ChevronDown className="size-3.5 text-tertiary" />
          ) : (
            <ChevronRight className="size-3.5 text-tertiary" />
          )}
          <span className="text-xs font-medium text-default">1 file changed</span>
          <span className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs! px-2! py-0.5!"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); }}
            >
              <Undo className="size-3" />
              Undo
            </Button>
          </span>
        </button>

        {/* File entry */}
        <div className="px-3 pb-2.5">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-secondary">
            <FileDocument className="size-3.5 text-tertiary" />
            <span className="text-xs text-secondary truncate flex-1 font-mono">
              {filePath}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-mono">
              {additions > 0 && (
                <span className="text-green-500">+{additions}</span>
              )}
              {deletions > 0 && (
                <span className="text-red-500">-{deletions}</span>
              )}
            </span>
            <div className="flex gap-px ml-1">
              {additions > 0 && <div className="w-1.5 h-1.5 rounded-[1px] bg-green-500" />}
              {deletions > 0 && <div className="w-1.5 h-1.5 rounded-[1px] bg-red-500" />}
            </div>
          </div>
        </div>

        {/* Expanded args */}
        {expanded && (
          <div className="px-3 pb-3 border-t border-subtle pt-2">
            <pre className="text-[11px] text-secondary font-mono whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">
              {JSON.stringify(part.args, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Non-file tool call: compact card
  return (
    <div className="mt-2 rounded-lg border border-default overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-secondary text-left transition-colors"
      >
        <Badge size="lg" color="info" className="text-[10px]!">
          TOOL
        </Badge>
        <span className="text-xs font-medium text-default">{part.toolName}</span>
        <span className="ml-auto text-[10px] text-tertiary">
          {expanded ? 'collapse' : 'expand'}
        </span>
      </button>

      {expanded && (
        <div className="px-3 py-2 border-t border-subtle">
          <pre className="text-[11px] text-secondary font-mono whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">
            {JSON.stringify(part.args, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

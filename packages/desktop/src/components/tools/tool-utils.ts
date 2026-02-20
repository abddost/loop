/**
 * Tool utility functions and constants.
 *
 * Shared by SimpleToolLine, FileChangeCard, BashCard, and the routing ToolCallCard.
 */

import { MAX_DIFF_LINES } from '../../constants';
import type { ToolCallPart, ToolResultPart, ToolStatus } from '../../types';

// ---------------------------------------------------------------------------
//  Tool categorization
// ---------------------------------------------------------------------------

export const FILE_CHANGE_TOOLS = new Set(['file-write', 'file-edit', 'file-patch']);
export const BASH_TOOL = 'bash';

export function isSimpleTextTool(name: string): boolean {
  return !FILE_CHANGE_TOOLS.has(name) && name !== BASH_TOOL;
}

// ---------------------------------------------------------------------------
//  Status helpers
// ---------------------------------------------------------------------------

/** Read tool status from part.status (preferred) or fallback to isRunning prop. */
export function getToolRunning(part: ToolCallPart, isRunning: boolean): boolean {
  if (part.status) {
    return part.status === 'pending' || part.status === 'running';
  }
  return isRunning;
}

export function getToolError(part: ToolCallPart): boolean {
  return part.status === 'error';
}

// ---------------------------------------------------------------------------
//  Human-readable label for read/simple tools
// ---------------------------------------------------------------------------

export function getSimpleLabel(part: ToolCallPart): string {
  const { toolName, args } = part;
  switch (toolName) {
    case 'file-read': {
      const p = String(args?.path ?? '');
      return `Read ${p.split('/').pop() || p}`;
    }
    case 'grep':
      return `Search for "${String(args?.pattern ?? args?.query ?? '').slice(0, 50)}"`;
    case 'glob':
      return `Glob ${String(args?.pattern ?? args?.glob ?? '')}`;
    case 'web-search':
      return `Web search "${String(args?.query ?? '').slice(0, 50)}"`;
    case 'web-fetch':
      return `Fetch ${String(args?.url ?? '')}`;
    case 'todo-read':
    case 'task-read':
      return 'Read task list';
    case 'todo-write':
    case 'task-write': {
      const todos = args?.todos ?? args?.tasks;
      const count = Array.isArray(todos) ? todos.length : 0;
      return count > 0 ? `Write ${count} tasks` : 'Write tasks';
    }
    case 'plan-save': {
      const planTitle = String(args?.title ?? '').slice(0, 60);
      return planTitle ? `Save plan: ${planTitle}` : 'Save plan';
    }
    case 'subagent': {
      const agentType = String(args?.agent ?? args?.agentType ?? 'agent');
      const desc = String(args?.description ?? args?.task ?? '').slice(0, 60);
      return desc ? `${agentType}: ${desc}` : `Run ${agentType}`;
    }
    case 'agent-instructions':
      return 'Read agent instructions';
    default:
      return toolName
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

// ---------------------------------------------------------------------------
//  File info extraction for write tools
// ---------------------------------------------------------------------------

export interface FileInfo {
  filePath: string;
  additions: number;
  deletions: number;
}

export function extractFileInfo(part: ToolCallPart): FileInfo {
  const filePath = String(part.args?.path ?? part.args?.filePath ?? '');
  let additions = 0;
  let deletions = 0;

  if (part.toolName === 'file-write' && part.args?.content) {
    additions = String(part.args.content).split('\n').length;
  } else if (part.toolName === 'file-edit' || part.toolName === 'file-patch') {
    const newStr = String(part.args?.new_string ?? part.args?.newString ?? '');
    const oldStr = String(part.args?.old_string ?? part.args?.oldString ?? '');
    if (newStr) additions = newStr.split('\n').length;
    if (oldStr) deletions = oldStr.split('\n').length;
  }

  return { filePath, additions, deletions };
}

// ---------------------------------------------------------------------------
//  Diff computation
// ---------------------------------------------------------------------------

export interface DiffLine {
  lineNumber: number;
  content: string;
  type: 'addition' | 'deletion' | 'context';
}

export function computeDiffLines(part: ToolCallPart): DiffLine[] {
  const lines: DiffLine[] = [];

  if (part.toolName === 'file-edit' || part.toolName === 'file-patch') {
    const oldStr = String(part.args?.old_string ?? part.args?.oldString ?? '');
    const newStr = String(part.args?.new_string ?? part.args?.newString ?? '');

    for (const [i, line] of (oldStr ? oldStr.split('\n') : []).entries()) {
      lines.push({ lineNumber: i + 1, content: line, type: 'deletion' });
    }
    for (const [i, line] of (newStr ? newStr.split('\n') : []).entries()) {
      lines.push({ lineNumber: i + 1, content: line, type: 'addition' });
    }
  } else if (part.toolName === 'file-write') {
    const content = String(part.args?.content ?? '');
    for (const [i, line] of content.split('\n').entries()) {
      if (i >= MAX_DIFF_LINES) break;
      lines.push({ lineNumber: i + 1, content: line, type: 'addition' });
    }
  }

  return lines.slice(0, MAX_DIFF_LINES);
}

// ---------------------------------------------------------------------------
//  Unified diff parsing (from tool result)
// ---------------------------------------------------------------------------

/**
 * Parse a unified diff string (from tool result `.output`) into DiffLine[].
 * Handles standard unified diff format with `@@` hunk headers, `+`/`-`/` `
 * line prefixes, and properly tracks old/new line numbers from hunks.
 */
export function parseUnifiedDiff(diffStr: string): { lines: DiffLine[]; truncated: boolean } {
  const rawLines = diffStr.split('\n');
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of rawLines) {
    if (lines.length >= MAX_DIFF_LINES) {
      return { lines, truncated: true };
    }

    // Skip top-level diff headers (---, +++, diff --git, Index:, ===)
    if (
      raw.startsWith('diff --git') ||
      raw.startsWith('---') ||
      raw.startsWith('+++') ||
      raw.startsWith('index ') ||
      raw.startsWith('Index:') ||
      raw.startsWith('===')
    ) {
      continue;
    }

    // Parse @@ hunk header to extract line numbers
    const hunkMatch = raw.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      // Emit as a separator marker (lineNumber 0 = hunk boundary)
      lines.push({ lineNumber: 0, content: raw, type: 'context' });
      continue;
    }

    // Diff body lines
    if (raw.startsWith('+')) {
      lines.push({ lineNumber: newLine, content: raw.slice(1), type: 'addition' });
      newLine++;
    } else if (raw.startsWith('-')) {
      lines.push({ lineNumber: oldLine, content: raw.slice(1), type: 'deletion' });
      oldLine++;
    } else if (raw.startsWith(' ')) {
      lines.push({ lineNumber: newLine, content: raw.slice(1), type: 'context' });
      oldLine++;
      newLine++;
    }
    // Skip "\ No newline at end of file" and any other noise
  }

  return { lines, truncated: false };
}

/**
 * Extract FileInfo preferring accurate counts from the tool result's unified
 * diff over the approximate counts derived from tool input args.
 *
 * Falls back to args-based `extractFileInfo(part)` when:
 * - result is not yet available (tool still running / streaming)
 * - result was compacted (context pruned)
 * - result is an error
 * - result output is not a string or doesn't look like a diff
 */
export function extractFileInfoFromResult(part: ToolCallPart, result?: ToolResultPart): FileInfo {
  const base = extractFileInfo(part);

  if (!result || result.compacted || result.isError) return base;

  const raw = result.output;
  if (typeof raw !== 'string' || !raw) return base;

  // Count additions/deletions by scanning the diff body lines
  let additions = 0;
  let deletions = 0;
  for (const line of raw.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }

  // Only override if we actually found diff content
  if (additions > 0 || deletions > 0) {
    return { filePath: base.filePath, additions, deletions };
  }

  return base;
}

/**
 * Parse diff lines from the tool result, falling back to args-based
 * reconstruction when the result is unavailable or not a unified diff.
 *
 * Priority:
 * 1. If `result.output` is a valid unified diff string → parseUnifiedDiff()
 * 2. Otherwise → computeDiffLines(part) from tool input args
 */
export function parseDiffFromResult(
  part: ToolCallPart,
  result?: ToolResultPart,
): { lines: DiffLine[]; truncated: boolean } {
  if (!result || result.compacted || result.isError) {
    return { lines: computeDiffLines(part), truncated: false };
  }

  const raw = result.output;
  if (typeof raw !== 'string' || !raw) {
    return { lines: computeDiffLines(part), truncated: false };
  }

  // Detect unified diff format: must have @@ hunk headers AND --- or +++ headers
  if (raw.includes('@@') && (raw.includes('---') || raw.includes('+++'))) {
    return parseUnifiedDiff(raw);
  }

  // Not a diff string (e.g. "Created file.ts (123 bytes)") — fall back to args
  return { lines: computeDiffLines(part), truncated: false };
}

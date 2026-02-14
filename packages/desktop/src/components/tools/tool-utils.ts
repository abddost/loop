/**
 * Tool utility functions and constants.
 *
 * Shared by SimpleToolLine, FileChangeCard, BashCard, and the routing ToolCallCard.
 */

import { MAX_DIFF_LINES } from '../../constants';
import type { ToolCallPart, ToolStatus } from '../../types';

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
      return 'Read task list';
    case 'todo-write': {
      const todos = args?.todos;
      const count = Array.isArray(todos) ? todos.length : 0;
      return count > 0 ? `Write ${count} tasks` : 'Write tasks';
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
  type: 'addition' | 'deletion';
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

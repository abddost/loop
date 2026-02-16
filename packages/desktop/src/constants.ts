/**
 * Application-wide constants.
 *
 * Centralizes magic values previously scattered across App.tsx,
 * ModelSelector.tsx, ToolCallCard.tsx, sse-pipe.ts, etc.
 */

import type { EffortOption } from './types';

// ---------------------------------------------------------------------------
//  Server connection
// ---------------------------------------------------------------------------

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:7878';
export const DEFAULT_AUTH_TOKEN = 'dev-token';

// ---------------------------------------------------------------------------
//  LocalStorage keys
// ---------------------------------------------------------------------------

export const STORAGE_KEYS = {
  ACTIVE_WORKSPACE: 'coding-assistant:activeWorkspaceId',
  ACTIVE_SESSION: 'coding-assistant:activeSessionId',
  THEME: 'coding-assistant:theme',
} as const;

// ---------------------------------------------------------------------------
//  Effort levels
// ---------------------------------------------------------------------------

export const EFFORTS: EffortOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'extra-high', label: 'Extra High' },
];

export const DEFAULT_EFFORT = 'extra-high';
export const DEFAULT_MODEL = 'openai:gpt-4o';

// ---------------------------------------------------------------------------
//  SSE batching
// ---------------------------------------------------------------------------

/** Batch flush interval in ms (roughly one frame at 60fps) */
export const BATCH_INTERVAL_MS = 16;

// ---------------------------------------------------------------------------
//  Tool display limits
// ---------------------------------------------------------------------------

/** Maximum number of diff lines to render in file-change tool cards */
export const MAX_DIFF_LINES = 120;

/** Maximum bash output characters to display */
export const MAX_BASH_OUTPUT_CHARS = 3000;

/** Maximum command characters before truncation */
export const MAX_COMMAND_DISPLAY_LENGTH = 80;

/** Number of files before FilePatchSummary auto-collapses */
export const FILE_PATCH_COLLAPSE_THRESHOLD = 5;

/**
 * File Snapshot -- tracks file system state at step boundaries.
 *
 * At step-start, captures a snapshot of file mtimes in the workspace.
 * At step-finish, diffs against the snapshot to produce a list of changed files.
 * This enables per-step file change visualization and undo/revert.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { MAX_SNAPSHOT_FILES, SNAPSHOT_MAX_DEPTH } from '../constants.js';

export interface FileSnapshot {
  /** Timestamp when the snapshot was captured */
  capturedAt: number;
  /** Map of relative file path -> mtime in ms */
  files: Map<string, number>;
}

export interface FilePatch {
  /** List of files that changed between snapshots */
  files: FilePatchEntry[];
}

export interface FilePatchEntry {
  /** Relative path from workspace root */
  path: string;
  /** Type of change */
  change: 'added' | 'modified' | 'deleted';
  /** mtime of the file (if not deleted) */
  mtime?: number;
}

/** Directories to always exclude from snapshot */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  '.cache',
  '__pycache__',
  '.DS_Store',
]);

// MAX_SNAPSHOT_FILES imported from constants.ts

/**
 * Capture a snapshot of file mtimes in a workspace directory.
 * Only tracks files in the top-level and one level deep for performance.
 */
export async function captureSnapshot(rootPath: string): Promise<FileSnapshot> {
  const files = new Map<string, number>();
  const capturedAt = Date.now();

  try {
    await walkDir(rootPath, rootPath, files, 0, SNAPSHOT_MAX_DEPTH);
  } catch {
    // If we can't read the directory, return an empty snapshot
  }

  return { capturedAt, files };
}

async function walkDir(
  base: string,
  dir: string,
  files: Map<string, number>,
  depth: number,
  maxDepth: number,
): Promise<void> {
  if (depth > maxDepth || files.size >= MAX_SNAPSHOT_FILES) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.size >= MAX_SNAPSHOT_FILES) break;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;

    const fullPath = join(dir, entry.name);

    if (entry.isFile()) {
      try {
        const s = await stat(fullPath);
        const relPath = relative(base, fullPath);
        files.set(relPath, s.mtimeMs);
      } catch {
        // Skip unreadable files
      }
    } else if (entry.isDirectory()) {
      await walkDir(base, fullPath, files, depth + 1, maxDepth);
    }
  }
}

/**
 * Diff two snapshots to find changed files.
 */
export function diffSnapshots(before: FileSnapshot, after: FileSnapshot): FilePatch {
  const entries: FilePatchEntry[] = [];

  // Check for modified and added files
  for (const [path, afterMtime] of after.files) {
    const beforeMtime = before.files.get(path);
    if (beforeMtime === undefined) {
      entries.push({ path, change: 'added', mtime: afterMtime });
    } else if (afterMtime > beforeMtime) {
      entries.push({ path, change: 'modified', mtime: afterMtime });
    }
  }

  // Check for deleted files
  for (const [path] of before.files) {
    if (!after.files.has(path)) {
      entries.push({ path, change: 'deleted' });
    }
  }

  return { files: entries };
}

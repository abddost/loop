/**
 * Task store -- persistent, workspace-scoped task storage.
 *
 * Stores tasks in `~/.coding-assistant/tasks/{workspaceId}.json`.
 * Uses atomic writes (write to temp file, then rename) and in-process
 * locking to prevent concurrent write corruption.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TaskItem {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  blocks: string[];
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskList {
  workspaceId: string;
  version: number;
  nextId: number;
  tasks: TaskItem[];
  updatedAt: string;
}

// ── Paths ──────────────────────────────────────────────────────────────────

const TASKS_DIR = join(homedir(), '.coding-assistant', 'tasks');

function taskFilePath(workspaceId: string): string {
  // Sanitize workspace ID for filesystem safety
  const safeId = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(TASKS_DIR, `${safeId}.json`);
}

// ── In-process locking ─────────────────────────────────────────────────────

const locks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any existing lock to release
  while (locks.has(key)) {
    await locks.get(key);
  }

  let resolve: () => void;
  const lockPromise = new Promise<void>((r) => { resolve = r; });
  locks.set(key, lockPromise);

  try {
    return await fn();
  } finally {
    locks.delete(key);
    resolve!();
  }
}

// ── CRUD operations ────────────────────────────────────────────────────────

function emptyTaskList(workspaceId: string): TaskList {
  return {
    workspaceId,
    version: 0,
    nextId: 1,
    tasks: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Read the task list for a workspace.
 * Returns an empty list if no file exists.
 */
export async function readTaskList(workspaceId: string): Promise<TaskList> {
  const filePath = taskFilePath(workspaceId);

  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as TaskList;
  } catch {
    return emptyTaskList(workspaceId);
  }
}

/**
 * Update the task list for a workspace with atomic write.
 *
 * Accepts an array of task items — items without an `id` get auto-assigned one.
 * Items with an existing `id` are upserted (merged).
 *
 * Returns the updated TaskList.
 */
export async function updateTaskList(
  workspaceId: string,
  tasks: Array<Partial<TaskItem> & { subject: string }>,
): Promise<TaskList> {
  return withLock(workspaceId, async () => {
    const existing = await readTaskList(workspaceId);
    const now = new Date().toISOString();

    for (const input of tasks) {
      if (input.id) {
        // Update existing task
        const idx = existing.tasks.findIndex((t) => t.id === input.id);
        if (idx >= 0) {
          existing.tasks[idx] = { ...existing.tasks[idx], ...input, updatedAt: now };
        } else {
          // ID provided but not found — treat as create with that ID
          existing.tasks.push({
            id: input.id,
            subject: input.subject,
            description: input.description ?? '',
            activeForm: input.activeForm ?? '',
            status: input.status ?? 'pending',
            blocks: input.blocks ?? [],
            blockedBy: input.blockedBy ?? [],
            createdAt: now,
            updatedAt: now,
          });
        }
      } else {
        // Create new task with auto-increment ID
        const id = String(existing.nextId++);
        existing.tasks.push({
          id,
          subject: input.subject,
          description: input.description ?? '',
          activeForm: input.activeForm ?? '',
          status: input.status ?? 'pending',
          blocks: input.blocks ?? [],
          blockedBy: input.blockedBy ?? [],
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    existing.version++;
    existing.updatedAt = now;

    // Atomic write: write to temp, then rename
    await mkdir(TASKS_DIR, { recursive: true });
    const filePath = taskFilePath(workspaceId);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, JSON.stringify(existing, null, 2), 'utf-8');
    await rename(tmpPath, filePath);

    return existing;
  });
}

/**
 * Delete a specific task by ID.
 */
export async function deleteTask(workspaceId: string, taskId: string): Promise<TaskList> {
  return withLock(workspaceId, async () => {
    const existing = await readTaskList(workspaceId);
    const before = existing.tasks.length;
    existing.tasks = existing.tasks.filter((t) => t.id !== taskId);

    if (existing.tasks.length === before) {
      return existing; // Nothing changed
    }

    // Also remove from blocks/blockedBy references
    for (const task of existing.tasks) {
      task.blocks = task.blocks.filter((id) => id !== taskId);
      task.blockedBy = task.blockedBy.filter((id) => id !== taskId);
    }

    existing.version++;
    existing.updatedAt = new Date().toISOString();

    await mkdir(TASKS_DIR, { recursive: true });
    const filePath = taskFilePath(workspaceId);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, JSON.stringify(existing, null, 2), 'utf-8');
    await rename(tmpPath, filePath);

    return existing;
  });
}

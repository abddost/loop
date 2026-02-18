/**
 * Task store -- session-scoped, per-file task storage.
 *
 * Storage layout:
 *   ~/.coding-assistant/tasks/{workspaceId}/
 *   ├── lists/
 *   │   └── {taskListId}/
 *   │       ├── meta.json        # TaskListMeta
 *   │       └── tasks/
 *   │           ├── 1.json       # Individual task files
 *   │           └── 2.json
 *   └── bindings.json            # { [sessionId]: taskListId }
 *
 * Lifecycle: When `task-write` is first called in a session, a new task list
 * is auto-created and the session is bound to it. `task-read` returns empty
 * for unbound sessions. Task lists persist independently of sessions.
 */

import { rename, mkdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { globalEventBus } from '../events/bus.js';

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

export interface TaskListMeta {
  id: string;
  name: string;
  workspaceId: string;
  version: number;
  nextId: number;
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

export interface UpdateResult extends TaskList {
  createdCount: number;
  updatedCount: number;
  taskListId: string;
}

// ── Paths ──────────────────────────────────────────────────────────────────

const TASKS_DIR = join(homedir(), '.coding-assistant', 'tasks');

function workspaceDirPath(workspaceId: string): string {
  const safeId = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(TASKS_DIR, safeId);
}

function bindingsFilePath(workspaceId: string): string {
  return join(workspaceDirPath(workspaceId), 'bindings.json');
}

function listsDirPath(workspaceId: string): string {
  return join(workspaceDirPath(workspaceId), 'lists');
}

function listDirPath(workspaceId: string, taskListId: string): string {
  return join(listsDirPath(workspaceId), taskListId);
}

function metaFilePath(workspaceId: string, taskListId: string): string {
  return join(listDirPath(workspaceId, taskListId), 'meta.json');
}

function tasksDirPath(workspaceId: string, taskListId: string): string {
  return join(listDirPath(workspaceId, taskListId), 'tasks');
}

function taskFilePath(workspaceId: string, taskListId: string, taskId: string): string {
  return join(tasksDirPath(workspaceId, taskListId), `${taskId}.json`);
}

// Legacy paths for migration
function legacyTaskDirPath(workspaceId: string): string {
  const safeId = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(TASKS_DIR, safeId);
}

function legacyTaskFilePath(workspaceId: string): string {
  return join(legacyTaskDirPath(workspaceId), 'tasks.json');
}

function legacyFlatFilePath(workspaceId: string): string {
  const safeId = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(TASKS_DIR, `${safeId}.json`);
}

// ── In-process locking ─────────────────────────────────────────────────────

const locks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
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

// ── Atomic file helpers ────────────────────────────────────────────────────

async function atomicWriteJSON(filePath: string, data: unknown): Promise<void> {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  await Bun.write(tmpPath, JSON.stringify(data));
  await rename(tmpPath, filePath);
}

async function readJSON<T>(filePath: string): Promise<T | null> {
  try {
    return await Bun.file(filePath).json() as T;
  } catch {
    return null;
  }
}

// ── Bindings ───────────────────────────────────────────────────────────────

export async function readBindings(workspaceId: string): Promise<Record<string, string>> {
  return (await readJSON<Record<string, string>>(bindingsFilePath(workspaceId))) ?? {};
}

export async function writeBindings(workspaceId: string, bindings: Record<string, string>): Promise<void> {
  await atomicWriteJSON(bindingsFilePath(workspaceId), bindings);
}

export async function getTaskListIdForSession(workspaceId: string, sessionId: string): Promise<string | null> {
  const bindings = await readBindings(workspaceId);
  return bindings[sessionId] ?? null;
}

export async function bindSession(workspaceId: string, sessionId: string, taskListId: string): Promise<void> {
  return withLock(`bindings:${workspaceId}`, async () => {
    const bindings = await readBindings(workspaceId);
    bindings[sessionId] = taskListId;
    await writeBindings(workspaceId, bindings);
  });
}

// ── Task list CRUD ─────────────────────────────────────────────────────────

export async function createTaskList(workspaceId: string, name?: string): Promise<string> {
  const taskListId = crypto.randomUUID();
  const now = new Date().toISOString();

  const meta: TaskListMeta = {
    id: taskListId,
    name: name ?? 'Untitled',
    workspaceId,
    version: 0,
    nextId: 1,
    createdAt: now,
    updatedAt: now,
  };

  await mkdir(tasksDirPath(workspaceId, taskListId), { recursive: true });
  await atomicWriteJSON(metaFilePath(workspaceId, taskListId), meta);

  return taskListId;
}

export async function readTaskListMeta(workspaceId: string, taskListId: string): Promise<TaskListMeta | null> {
  return readJSON<TaskListMeta>(metaFilePath(workspaceId, taskListId));
}

async function writeTaskListMeta(workspaceId: string, taskListId: string, meta: TaskListMeta): Promise<void> {
  await atomicWriteJSON(metaFilePath(workspaceId, taskListId), meta);
}

export async function readAllTasks(workspaceId: string, taskListId: string): Promise<TaskItem[]> {
  const dir = tasksDirPath(workspaceId, taskListId);
  const glob = new Bun.Glob("*.json");
  const tasks: TaskItem[] = [];

  try {
    for await (const file of glob.scan({ cwd: dir })) {
      const task = await readJSON<TaskItem>(join(dir, file));
      if (task) tasks.push(task);
    }
  } catch {
    return [];
  }

  // Sort by numeric ID for stable ordering
  tasks.sort((a, b) => Number(a.id) - Number(b.id));
  return tasks;
}

export async function writeTask(workspaceId: string, taskListId: string, task: TaskItem): Promise<void> {
  await atomicWriteJSON(taskFilePath(workspaceId, taskListId, task.id), task);
}

export async function deleteTaskFile(workspaceId: string, taskListId: string, taskId: string): Promise<void> {
  try {
    await unlink(taskFilePath(workspaceId, taskListId, taskId));
  } catch {
    // File may not exist
  }

  // Clean up block/blockedBy references in remaining tasks
  const tasks = await readAllTasks(workspaceId, taskListId);
  for (const task of tasks) {
    const hadBlock = task.blocks.includes(taskId);
    const hadBlockedBy = task.blockedBy.includes(taskId);
    if (hadBlock || hadBlockedBy) {
      task.blocks = task.blocks.filter((id) => id !== taskId);
      task.blockedBy = task.blockedBy.filter((id) => id !== taskId);
      await writeTask(workspaceId, taskListId, task);
    }
  }
}

// ── Session-scoped operations ──────────────────────────────────────────────

/**
 * Read tasks for a session. Returns empty if session is not bound to a task list.
 */
export async function readTasksForSession(
  workspaceId: string,
  sessionId: string,
): Promise<{ tasks: TaskItem[]; version: number; taskListId: string | null }> {
  // Lazy migration on first access
  await migrateFromMonolith(workspaceId);

  const taskListId = await getTaskListIdForSession(workspaceId, sessionId);
  if (!taskListId) {
    return { tasks: [], version: 0, taskListId: null };
  }

  const meta = await readTaskListMeta(workspaceId, taskListId);
  if (!meta) {
    return { tasks: [], version: 0, taskListId };
  }

  const tasks = await readAllTasks(workspaceId, taskListId);
  return { tasks, version: meta.version, taskListId };
}

/**
 * Update tasks for a session. Auto-creates task list + binding on first call.
 */
export async function updateTasksForSession(
  workspaceId: string,
  sessionId: string,
  tasks: Array<Partial<TaskItem> & { subject: string }>,
): Promise<UpdateResult> {
  // Resolve or auto-create binding
  let taskListId = await getTaskListIdForSession(workspaceId, sessionId);

  if (!taskListId) {
    // Auto-create task list named after the first task's subject
    const name = tasks[0]?.subject ?? 'Untitled';
    taskListId = await createTaskList(workspaceId, name);
    await bindSession(workspaceId, sessionId, taskListId);
  }

  return withLock(`tasklist:${taskListId}`, async () => {
    const meta = (await readTaskListMeta(workspaceId, taskListId!)) ?? {
      id: taskListId!,
      name: 'Untitled',
      workspaceId,
      version: 0,
      nextId: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const existingTasks = await readAllTasks(workspaceId, taskListId!);
    const now = new Date().toISOString();
    let createdCount = 0;
    let updatedCount = 0;
    const taskMap = new Map(existingTasks.map((t) => [t.id, t]));
    const subjectMap = new Map(existingTasks.map((t) => [t.subject, t]));

    for (const input of tasks) {
      if (input.id) {
        // Update existing task by ID
        const existing = taskMap.get(input.id);
        if (existing) {
          const updated = { ...existing, ...input, updatedAt: now };
          taskMap.set(updated.id, updated);
          await writeTask(workspaceId, taskListId!, updated);
          updatedCount++;
        } else {
          // ID provided but not found -- create with that ID
          const newTask: TaskItem = {
            id: input.id,
            subject: input.subject,
            description: input.description ?? '',
            activeForm: input.activeForm ?? '',
            status: input.status ?? 'pending',
            blocks: input.blocks ?? [],
            blockedBy: input.blockedBy ?? [],
            createdAt: now,
            updatedAt: now,
          };
          taskMap.set(newTask.id, newTask);
          await writeTask(workspaceId, taskListId!, newTask);
          createdCount++;
        }
      } else {
        // Defensive dedup: match by subject when id is omitted
        const existingBySubject = subjectMap.get(input.subject);

        if (existingBySubject) {
          const updated: TaskItem = {
            ...existingBySubject,
            ...input,
            id: existingBySubject.id,
            createdAt: existingBySubject.createdAt,
            updatedAt: now,
          };
          taskMap.set(updated.id, updated);
          subjectMap.set(updated.subject, updated);
          await writeTask(workspaceId, taskListId!, updated);
          updatedCount++;
        } else {
          // Genuinely new task
          const id = String(meta.nextId++);
          const newTask: TaskItem = {
            id,
            subject: input.subject,
            description: input.description ?? '',
            activeForm: input.activeForm ?? '',
            status: input.status ?? 'pending',
            blocks: input.blocks ?? [],
            blockedBy: input.blockedBy ?? [],
            createdAt: now,
            updatedAt: now,
          };
          taskMap.set(newTask.id, newTask);
          subjectMap.set(newTask.subject, newTask);
          await writeTask(workspaceId, taskListId!, newTask);
          createdCount++;
        }
      }
    }

    // Update meta
    meta.version++;
    meta.updatedAt = now;
    await writeTaskListMeta(workspaceId, taskListId!, meta);

    const allTasks = [...taskMap.values()].sort((a, b) => Number(a.id) - Number(b.id));

    // Emit SSE event for real-time UI updates
    globalEventBus.emit({
      type: 'tasks-changed',
      workspaceId,
      sessionId,
      taskListId: taskListId!,
      timestamp: now,
      version: meta.version,
      totalTasks: allTasks.length,
      completedTasks: allTasks.filter((t) => t.status === 'completed').length,
    } as any);

    return {
      workspaceId,
      version: meta.version,
      nextId: meta.nextId,
      tasks: allTasks,
      updatedAt: now,
      createdCount,
      updatedCount,
      taskListId: taskListId!,
    };
  });
}

/**
 * Delete a specific task by ID within a session's bound task list.
 */
export async function deleteTaskForSession(
  workspaceId: string,
  sessionId: string,
  taskId: string,
): Promise<{ tasks: TaskItem[]; version: number; taskListId: string | null }> {
  const taskListId = await getTaskListIdForSession(workspaceId, sessionId);
  if (!taskListId) {
    return { tasks: [], version: 0, taskListId: null };
  }

  return withLock(`tasklist:${taskListId}`, async () => {
    await deleteTaskFile(workspaceId, taskListId!, taskId);

    const meta = await readTaskListMeta(workspaceId, taskListId!);
    if (meta) {
      meta.version++;
      meta.updatedAt = new Date().toISOString();
      await writeTaskListMeta(workspaceId, taskListId!, meta);
    }

    const tasks = await readAllTasks(workspaceId, taskListId!);
    const version = meta?.version ?? 0;

    // Emit SSE event
    globalEventBus.emit({
      type: 'tasks-changed',
      workspaceId,
      sessionId,
      taskListId: taskListId!,
      timestamp: new Date().toISOString(),
      version,
      totalTasks: tasks.length,
      completedTasks: tasks.filter((t) => t.status === 'completed').length,
    } as any);

    return { tasks, version, taskListId };
  });
}

/**
 * List available task list metas for a workspace (for future connect feature).
 */
export async function listTaskLists(workspaceId: string): Promise<TaskListMeta[]> {
  const dir = listsDirPath(workspaceId);
  const glob = new Bun.Glob("*/meta.json");
  const metas: TaskListMeta[] = [];

  try {
    for await (const file of glob.scan({ cwd: dir })) {
      const meta = await readJSON<TaskListMeta>(join(dir, file));
      if (meta) metas.push(meta);
    }
  } catch {
    return [];
  }

  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ── Migration ──────────────────────────────────────────────────────────────

const migrationChecked = new Set<string>();

/**
 * Migrate from monolithic tasks.json to per-file storage.
 * Runs lazily on first readTasksForSession call per workspace.
 */
async function migrateFromMonolith(workspaceId: string): Promise<void> {
  if (migrationChecked.has(workspaceId)) return;
  migrationChecked.add(workspaceId);

  // Check for legacy monolithic file (both directory-based and flat-file)
  let legacyPath: string | null = null;
  let legacyData: TaskList | null = null;

  const dirPath = legacyTaskFilePath(workspaceId);
  const dirStat = await stat(dirPath).catch(() => null);
  if (dirStat?.isFile()) {
    try {
      legacyData = await Bun.file(dirPath).json() as TaskList;
      legacyPath = dirPath;
    } catch {
      // Corrupted file, skip
    }
  }

  if (!legacyData) {
    const flatPath = legacyFlatFilePath(workspaceId);
    const flatStat = await stat(flatPath).catch(() => null);
    if (flatStat?.isFile()) {
      try {
        legacyData = await Bun.file(flatPath).json() as TaskList;
        legacyPath = flatPath;
      } catch {
        // Corrupted file, skip
      }
    }
  }

  if (!legacyData || !legacyPath || legacyData.tasks.length === 0) return;

  // Check if migration already happened (lists dir exists with content)
  const listsDir = listsDirPath(workspaceId);
  try {
    const glob = new Bun.Glob("*");
    for await (const _ of glob.scan({ cwd: listsDir })) {
      return; // Already migrated (at least one entry found)
    }
  } catch {
    // Lists dir doesn't exist yet -- proceed with migration
  }

  // Create a new task list and split tasks into individual files
  const taskListId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Dedup tasks by subject
  const seen = new Map<string, { task: TaskItem; index: number }>();
  for (let i = 0; i < legacyData.tasks.length; i++) {
    const task = legacyData.tasks[i];
    const existing = seen.get(task.subject);
    if (!existing || task.updatedAt > existing.task.updatedAt) {
      seen.set(task.subject, { task, index: i });
    }
  }
  const deduped = [...seen.values()]
    .sort((a, b) => a.index - b.index)
    .map(({ task }, i) => ({ ...task, id: String(i + 1) }));

  const meta: TaskListMeta = {
    id: taskListId,
    name: deduped[0]?.subject ?? 'Migrated Tasks',
    workspaceId,
    version: legacyData.version + 1,
    nextId: deduped.length + 1,
    createdAt: now,
    updatedAt: now,
  };

  await mkdir(tasksDirPath(workspaceId, taskListId), { recursive: true });
  await atomicWriteJSON(metaFilePath(workspaceId, taskListId), meta);

  for (const task of deduped) {
    await atomicWriteJSON(taskFilePath(workspaceId, taskListId, task.id), task);
  }

  // Do NOT auto-bind to any session (orphaned but discoverable)
  // Rename legacy file to .migrated
  await rename(legacyPath, `${legacyPath}.migrated`).catch(() => {});
}

// ── Legacy API (kept for backward compat during transition) ────────────────

/**
 * @deprecated Use readTasksForSession instead
 */
export async function readTaskList(workspaceId: string): Promise<TaskList> {
  return {
    workspaceId,
    version: 0,
    nextId: 1,
    tasks: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * @deprecated Use updateTasksForSession instead
 */
export async function updateTaskList(
  workspaceId: string,
  tasks: Array<Partial<TaskItem> & { subject: string }>,
): Promise<UpdateResult> {
  // Fallback: operate without session binding (workspace-scoped)
  return updateTasksForSession(workspaceId, '_legacy', tasks);
}

/**
 * @deprecated Use deleteTaskForSession instead
 */
export async function deleteTask(
  workspaceId: string,
  taskId: string,
): Promise<TaskList> {
  const result = await deleteTaskForSession(workspaceId, '_legacy', taskId);
  return {
    workspaceId,
    version: result.version,
    nextId: 0,
    tasks: result.tasks,
    updatedAt: new Date().toISOString(),
  };
}

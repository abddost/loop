/**
 * File change events -- emitted by file tools to signal changes
 * for UI updates, audit trails, and reactive systems.
 */

export type FileChangeType = 'created' | 'modified' | 'deleted';

export interface FileChangeEvent {
  /** The type of change */
  type: FileChangeType;
  /** Workspace-relative path */
  path: string;
  /** Absolute resolved path */
  resolvedPath: string;
  /** Modification timestamp after the change */
  mtime?: number;
  /** Diff stats if available */
  additions?: number;
  deletions?: number;
}

/**
 * Emit a file change event through the tool context's metadata emitter.
 * Falls back to no-op if emitMetadata is not available.
 */
export function emitFileChange(
  emitMetadata: ((metadata: Record<string, unknown>) => void) | undefined,
  event: FileChangeEvent,
): void {
  emitMetadata?.({
    fileChange: {
      type: event.type,
      path: event.path,
      resolvedPath: event.resolvedPath,
      mtime: event.mtime,
      additions: event.additions,
      deletions: event.deletions,
    },
  });
}

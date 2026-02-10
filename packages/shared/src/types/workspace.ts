/**
 * Workspace types -- one workspace per open directory.
 */

export interface WorkspaceInfo {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
}

export interface GitState {
  /** Whether the directory is inside a git repository */
  isRepo: boolean;
  /** Current branch name, if any */
  branch: string | null;
  /** Whether there are uncommitted changes */
  dirty: boolean;
  /** Root of the git worktree */
  worktreeRoot: string | null;
  /** Remote URL if available */
  remoteUrl: string | null;
}

export type WorkspaceStatus = 'active' | 'closing' | 'closed';

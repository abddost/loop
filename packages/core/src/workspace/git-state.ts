/**
 * Git state detection for a workspace directory.
 */

import type { GitState } from '@coding-assistant/shared';
import { GIT_COMMAND_TIMEOUT_MS } from '../constants.js';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(resolve, ms, null)),
  ]);
}

export async function detectGitState(rootPath: string): Promise<GitState> {
  const [branch, status, worktreeRoot, remoteUrl] = await Promise.all([
    withTimeout(
      Bun.$`git rev-parse --abbrev-ref HEAD`.quiet().nothrow().cwd(rootPath).text()
        .then(s => s.trim() || null).catch(() => null),
      GIT_COMMAND_TIMEOUT_MS,
    ),
    withTimeout(
      Bun.$`git status --porcelain`.quiet().nothrow().cwd(rootPath).text()
        .then(s => s.trim() || null).catch(() => null),
      GIT_COMMAND_TIMEOUT_MS,
    ),
    withTimeout(
      Bun.$`git rev-parse --show-toplevel`.quiet().nothrow().cwd(rootPath).text()
        .then(s => s.trim() || null).catch(() => null),
      GIT_COMMAND_TIMEOUT_MS,
    ),
    withTimeout(
      Bun.$`git config --get remote.origin.url`.quiet().nothrow().cwd(rootPath).text()
        .then(s => s.trim() || null).catch(() => null),
      GIT_COMMAND_TIMEOUT_MS,
    ),
  ]);

  if (!branch || !worktreeRoot) {
    return {
      isRepo: false,
      branch: null,
      dirty: false,
      worktreeRoot: null,
      remoteUrl: null,
    };
  }

  return {
    isRepo: true,
    branch,
    dirty: (status?.length ?? 0) > 0,
    worktreeRoot,
    remoteUrl,
  };
}

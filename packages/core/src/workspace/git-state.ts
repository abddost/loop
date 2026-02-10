/**
 * Git state detection for a workspace directory.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitState } from '@coding-assistant/shared';

const execAsync = promisify(exec);

async function git(cwd: string, args: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`git ${args}`, { cwd, timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function detectGitState(rootPath: string): Promise<GitState> {
  const branch = await git(rootPath, 'rev-parse --abbrev-ref HEAD');

  if (!branch) {
    return {
      isRepo: false,
      branch: null,
      dirty: false,
      worktreeRoot: null,
      remoteUrl: null,
    };
  }

  const status = await git(rootPath, 'status --porcelain');
  const worktreeRoot = await git(rootPath, 'rev-parse --show-toplevel');
  const remoteUrl = await git(rootPath, 'config --get remote.origin.url');

  return {
    isRepo: true,
    branch,
    dirty: (status?.length ?? 0) > 0,
    worktreeRoot,
    remoteUrl,
  };
}

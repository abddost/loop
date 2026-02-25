/**
 * Git state detection for a workspace directory.
 *
 * Note: .git folder being "hidden" (dot-prefix) does NOT affect detection —
 * it's just a naming convention; Git and the filesystem see it normally.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { GitState } from '@coding-assistant/shared';
import { GIT_COMMAND_TIMEOUT_MS } from '../constants.js';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(resolve, ms, null)),
  ]);
}

/** Resolve path to absolute, expanding ~ to home directory */
function resolveRootPath(rootPath: string): string {
  const expanded = rootPath.startsWith('~')
    ? rootPath.replace(/^~(?:\/|$)/, homedir() + '/')
    : rootPath;
  return resolve(expanded);
}

async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    if (proc.exitCode !== 0 && process.env.DEBUG_GIT_STATE && err) {
      console.log('[detectGitState] git failed:', args.join(' '), 'cwd:', cwd, 'stderr:', err.trim());
    }
    return proc.exitCode === 0 ? out.trim() || null : null;
  } catch (e) {
    if (process.env.DEBUG_GIT_STATE) {
      console.log('[detectGitState] git threw:', e);
    }
    return null;
  }
}

export async function detectGitState(rootPath: string): Promise<GitState> {
  const resolvedPath = resolveRootPath(rootPath);

  if (!existsSync(resolvedPath)) {
    if (process.env.DEBUG_GIT_STATE) {
      console.log('[detectGitState] path does not exist:', resolvedPath, '(original:', rootPath, ')');
    }
    return {
      isRepo: false,
      branch: null,
      dirty: false,
      worktreeRoot: null,
      remoteUrl: null,
    };
  }

  const [branch, status, worktreeRoot, remoteUrl] = await Promise.all([
    withTimeout(runGit(resolvedPath, ['rev-parse', '--abbrev-ref', 'HEAD']), GIT_COMMAND_TIMEOUT_MS),
    withTimeout(runGit(resolvedPath, ['status', '--porcelain']), GIT_COMMAND_TIMEOUT_MS),
    withTimeout(runGit(resolvedPath, ['rev-parse', '--show-toplevel']), GIT_COMMAND_TIMEOUT_MS),
    withTimeout(runGit(resolvedPath, ['config', '--get', 'remote.origin.url']), GIT_COMMAND_TIMEOUT_MS),
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

/**
 * Workspace boundary check utility.
 *
 * Used by tools to detect paths outside the workspace and
 * request `external_directory` permission via ctx.ask().
 */

import { resolve, relative, dirname, join } from 'node:path';
import type { ToolExecCtx } from './types.js';

function containsPath(parent: string, child: string): boolean {
  const rel = relative(parent, resolve(child));
  return !rel.startsWith('..');
}

export async function assertExternalDirectory(
  ctx: ToolExecCtx,
  target: string,
  options?: { bypass?: boolean; kind?: 'file' | 'directory' },
): Promise<void> {
  if (!target || options?.bypass) return;
  if (containsPath(ctx.workspaceRootPath, target)) return;

  const parentDir = options?.kind === 'directory' ? target : dirname(target);
  const glob = join(parentDir, '*');

  await ctx.ask({
    permission: 'external_directory',
    patterns: [glob],
    always: [glob],
    metadata: { filepath: target, parentDir },
  });
}

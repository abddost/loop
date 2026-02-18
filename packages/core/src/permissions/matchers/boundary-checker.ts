/**
 * Path boundary checker — verifies paths stay within workspace boundaries.
 */

import { resolve, relative, isAbsolute } from 'node:path';
import { realpathSync } from 'node:fs';

export type BoundaryViolation = 'outside-workspace' | 'symlink-escape' | 'parent-traversal';

export interface BoundaryCheckResult {
  safe: boolean;
  violations: Array<{
    path: string;
    resolved: string;
    violation: BoundaryViolation;
  }>;
}

/**
 * Check whether all given paths stay within the workspace root.
 * Detects parent traversal, symlink escapes, and paths outside the workspace.
 */
export function checkPathBoundaries(
  paths: string[],
  workspaceRoot: string,
  cwd: string,
): BoundaryCheckResult {
  const violations: BoundaryCheckResult['violations'] = [];

  for (const raw of paths) {
    const abs = isAbsolute(raw) ? raw : resolve(cwd, raw);

    // Detect explicit parent traversal in the raw path
    const segments = raw.split(/[\\/]/);
    if (segments.includes('..')) {
      const rel = relative(workspaceRoot, abs);
      if (rel.startsWith('..')) {
        violations.push({ path: raw, resolved: abs, violation: 'parent-traversal' });
        continue;
      }
    }

    // Follow symlinks to get the real path
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      // Path doesn't exist yet — use the resolved absolute path
      real = abs;
    }

    // Check if the real path is outside the workspace
    const rel = relative(workspaceRoot, real);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      // If the raw resolved path is inside but real path is outside, it's a symlink escape
      const rawRel = relative(workspaceRoot, abs);
      const isRawInside = !rawRel.startsWith('..') && !isAbsolute(rawRel);

      violations.push({
        path: raw,
        resolved: real,
        violation: isRawInside ? 'symlink-escape' : 'outside-workspace',
      });
    }
  }

  return { safe: violations.length === 0, violations };
}

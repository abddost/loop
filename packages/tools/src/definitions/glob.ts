/**
 * glob tool -- finds files matching a glob pattern.
 */

import { z } from 'zod';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  pattern: z.string().describe('Glob pattern to match files (e.g., "**/*.ts")'),
  path: z.string().optional().describe('Directory to search in (relative to workspace root)'),
});

type Input = z.infer<typeof inputSchema>;

function matchesSimpleGlob(filePath: string, pattern: string): boolean {
  // Simple glob matching for common patterns
  const regexPattern = pattern
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\./g, '\\.');

  return new RegExp(`^${regexPattern}$`).test(filePath);
}

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkDir(fullPath)));
      } else {
        files.push(fullPath);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return files;
}

export const definition: ToolDefinition<Input, string> = {
  name: 'glob',
  description: 'Find files matching a glob pattern',
  inputSchema,
  category: 'search',
  riskLevel: 'safe',

  async execute(input, ctx) {
    const searchDir = input.path
      ? join(ctx.workspaceRootPath, input.path)
      : ctx.workspaceRootPath;

    const allFiles = await walkDir(searchDir);
    const pattern = input.pattern.startsWith('**/')
      ? input.pattern
      : `**/${input.pattern}`;

    const matched = allFiles
      .map((f) => relative(ctx.workspaceRootPath, f))
      .filter((f) => matchesSimpleGlob(f, pattern))
      .sort();

    if (matched.length === 0) {
      return { result: 'No files matched.' };
    }

    // Get file stats for sorting by modification time
    const withStats = await Promise.all(
      matched.map(async (f) => {
        try {
          const s = await stat(join(ctx.workspaceRootPath, f));
          return { path: f, mtime: s.mtimeMs };
        } catch {
          return { path: f, mtime: 0 };
        }
      }),
    );

    withStats.sort((a, b) => b.mtime - a.mtime);

    return {
      result: withStats.map((f) => f.path).join('\n'),
      metadata: { matchCount: withStats.length },
    };
  },
};

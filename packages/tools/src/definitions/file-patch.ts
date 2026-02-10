/**
 * file-patch tool -- applies multi-line patches to files.
 */

import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  path: z.string().describe('Path to the file to patch'),
  patches: z.array(z.object({
    startLine: z.number().describe('Start line number (1-indexed)'),
    endLine: z.number().describe('End line number (inclusive)'),
    content: z.string().describe('Replacement content for the line range'),
  })).describe('Array of patches to apply'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'file-patch',
  description: 'Apply line-range patches to a file',
  inputSchema,
  category: 'file-write',
  riskLevel: 'moderate',

  async execute(input, ctx) {
    const filePath = isAbsolute(input.path)
      ? input.path
      : join(ctx.workspaceRootPath, input.path);

    const resolved = resolve(filePath);
    const rel = relative(ctx.workspaceRootPath, resolved);
    if (rel.startsWith('..')) {
      throw new Error(`Path is outside workspace: ${input.path}`);
    }

    const lock = await ctx.writeLock(resolved);
    try {
      const content = await readFile(resolved, 'utf-8');
      const lines = content.split('\n');

      // Sort patches by startLine descending (apply from bottom up)
      const sorted = [...input.patches].sort((a, b) => b.startLine - a.startLine);

      for (const patch of sorted) {
        const start = patch.startLine - 1;
        const end = patch.endLine;
        const replacement = patch.content.split('\n');
        lines.splice(start, end - start, ...replacement);
      }

      await writeFile(resolved, lines.join('\n'), 'utf-8');

      return {
        result: `Applied ${input.patches.length} patches to ${rel}`,
        metadata: { path: rel, patchCount: input.patches.length },
      };
    } finally {
      lock.release();
    }
  },
};

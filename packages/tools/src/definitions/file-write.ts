/**
 * file-write tool -- writes content to a file in the workspace.
 */

import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  path: z.string().describe('Path to write to (relative to workspace root)'),
  contents: z.string().describe('Content to write to the file'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'file-write',
  description: 'Write contents to a file. Creates the file and parent directories if they do not exist.',
  inputSchema,
  category: 'file-write',
  riskLevel: 'moderate',

  async execute(input, ctx) {
    const filePath = isAbsolute(input.path)
      ? input.path
      : join(ctx.workspaceRootPath, input.path);

    // Ensure within workspace
    const resolved = resolve(filePath);
    const rel = relative(ctx.workspaceRootPath, resolved);
    if (rel.startsWith('..')) {
      throw new Error(`Path is outside workspace: ${input.path}`);
    }

    // Acquire write lock
    const lock = await ctx.writeLock(resolved);
    try {
      // Ensure parent directory exists
      await mkdir(dirname(resolved), { recursive: true });

      // Write file
      await writeFile(resolved, input.contents, 'utf-8');

      return {
        result: `Wrote ${input.contents.length} bytes to ${rel}`,
        metadata: {
          bytesWritten: input.contents.length,
          path: rel,
        },
      };
    } finally {
      lock.release();
    }
  },
};

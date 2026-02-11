/**
 * file-read tool -- reads file contents from the workspace.
 */

import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  path: z.string().describe('Path to the file to read (relative to workspace root)'),
  offset: z.number().optional().describe('Line number to start reading from (1-indexed)'),
  limit: z.number().optional().describe('Number of lines to read'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'file-read',
  description: 'Read the contents of a file from the workspace',
  inputSchema,
  category: 'file-read',
  riskLevel: 'safe',

  async execute(input, ctx) {
    const filePath = isAbsolute(input.path)
      ? input.path
      : join(ctx.workspaceRootPath, input.path);

    // Ensure the path is within the workspace
    const resolved = resolve(filePath);
    const rel = relative(ctx.workspaceRootPath, resolved);
    if (rel.startsWith('..')) {
      throw new Error(`Path is outside workspace: ${input.path}`);
    }

    // Check file exists and is not too large
    const fileStat = await stat(resolved);
    if (fileStat.size > 10 * 1024 * 1024) {
      throw new Error('File is too large (>10MB). Use offset and limit to read portions.');
    }

    const content = await readFile(resolved, 'utf-8');

    // Record read timestamp
    ctx.fileReadTimestamps.set(resolved, Date.now());

    // Apply offset/limit
    if (input.offset !== undefined || input.limit !== undefined) {
      const lines = content.split('\n');
      const start = (input.offset ?? 1) - 1;
      const end = input.limit ? start + input.limit : lines.length;
      const sliced = lines.slice(Math.max(0, start), end);

      return {
        result: sliced
          .map((line, i) => `${String(start + i + 1).padStart(6)}|${line}`)
          .join('\n'),
        metadata: {
          bytesRead: fileStat.size,
          totalLines: lines.length,
          returnedLines: sliced.length,
        },
      };
    }

    // Full file with line numbers
    const lines = content.split('\n');
    return {
      result: lines
        .map((line, i) => `${String(i + 1).padStart(6)}|${line}`)
        .join('\n'),
      metadata: {
        bytesRead: fileStat.size,
        totalLines: lines.length,
      },
    };
  },
};

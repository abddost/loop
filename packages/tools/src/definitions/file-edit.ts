/**
 * file-edit tool -- performs exact string replacement in files.
 */

import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  path: z.string().describe('Path to the file to edit'),
  old_string: z.string().describe('The exact string to find and replace'),
  new_string: z.string().describe('The replacement string'),
  replace_all: z.boolean().optional().default(false).describe('Replace all occurrences'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'file-edit',
  description: 'Perform exact string replacement in a file',
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

      if (!content.includes(input.old_string)) {
        throw new Error('old_string not found in file. Ensure it matches exactly.');
      }

      // Check uniqueness if not replacing all
      if (!input.replace_all) {
        const occurrences = content.split(input.old_string).length - 1;
        if (occurrences > 1) {
          throw new Error(
            `old_string found ${occurrences} times. Use replace_all=true or provide more context to make it unique.`,
          );
        }
      }

      const newContent = input.replace_all
        ? content.split(input.old_string).join(input.new_string)
        : content.replace(input.old_string, input.new_string);

      await writeFile(resolved, newContent, 'utf-8');

      return {
        result: `Edited ${rel}`,
        metadata: { path: rel },
      };
    } finally {
      lock.release();
    }
  },
};

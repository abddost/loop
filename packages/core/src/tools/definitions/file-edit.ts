/**
 * file-edit tool -- performs string replacement in files with progressive
 * fuzzy matching for LLM-generated edits.
 *
 * Uses 8 matching strategies from strictest to loosest to handle common
 * LLM mistakes: wrong indentation, trailing whitespace, escape sequences, etc.
 */

import { z } from 'zod';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { replace, normalizeLineEndings } from '../file-edit/replacers.js';
import { generateUnifiedDiff, computeDiffStats } from '../file-edit/diff.js';
import { assertFileReadBeforeWrite } from '../file-edit/file-time.js';
import { isBinaryFile } from '../file-edit/binary-detect.js';
import { emitFileChange } from '../file-edit/events.js';

const inputSchema = z.object({
  path: z.string().describe('Path to the file to edit'),
  old_string: z.string().describe('The exact string to find and replace'),
  new_string: z.string().describe('The replacement string'),
  replace_all: z.boolean().optional().default(false).describe('Replace all occurrences'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'file-edit',
  description: 'Perform string replacement in a file (supports fuzzy matching for imperfect inputs)',
  inputSchema,
  category: 'file-write',
  riskLevel: 'moderate',

  async execute(input, ctx) {
    // Guard: old_string === new_string is a no-op
    if (input.old_string === input.new_string) {
      throw new Error('old_string and new_string are identical. No changes needed.');
    }

    const filePath = isAbsolute(input.path)
      ? input.path
      : join(ctx.workspaceRootPath, input.path);

    const resolved = resolve(filePath);
    const rel = relative(ctx.workspaceRootPath, resolved);
    if (rel.startsWith('..')) {
      throw new Error(`Path is outside workspace: ${input.path}`);
    }

    // Phase 3: Binary file guard
    if (await isBinaryFile(resolved)) {
      throw new Error(`Cannot edit binary file: ${rel}`);
    }

    // Phase 2: Ensure file was read before editing
    await assertFileReadBeforeWrite(ctx, resolved, rel);

    const lock = await ctx.writeLock(resolved);
    try {
      const rawContent = await Bun.file(resolved).text();
      const content = normalizeLineEndings(rawContent);

      // Phase 1: Progressive fuzzy matching
      const result = replace(
        content,
        input.old_string,
        input.new_string,
        input.replace_all,
      );

      await Bun.write(resolved, result.content);

      // Update read timestamp after our own write
      ctx.fileReadTimestamps.set(resolved, Date.now());

      // Phase 4: Generate diff for result
      const diff = generateUnifiedDiff(rel, content, result.content);
      const stats = computeDiffStats(content, result.content);

      // Phase 7: Emit file change event
      const editedFile = Bun.file(resolved);
      emitFileChange(ctx.emitMetadata, {
        type: 'modified',
        path: rel,
        resolvedPath: resolved,
        mtime: editedFile.lastModified,
        additions: stats.additions,
        deletions: stats.deletions,
      });

      const strategyNote = result.exact ? '' : ` (matched via ${result.strategy})`;

      return {
        result: diff,
        metadata: {
          path: rel,
          diff,
          additions: stats.additions,
          deletions: stats.deletions,
          strategy: result.strategy,
          fuzzyMatch: !result.exact,
          note: strategyNote ? `Fuzzy match used: ${result.strategy}` : undefined,
        },
      };
    } finally {
      lock.release();
    }
  },
};

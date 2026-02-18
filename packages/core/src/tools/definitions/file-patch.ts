/**
 * file-patch tool -- applies multi-line patches to files.
 *
 * Validates patch bounds and overlaps before applying, normalizes
 * line endings, and generates diffs for all changes.
 */

import { z } from 'zod';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { assertFileReadBeforeWrite } from '../file-edit/file-time.js';
import { generateUnifiedDiff, computeDiffStats } from '../file-edit/diff.js';
import { normalizeLineEndings } from '../file-edit/replacers.js';
import { emitFileChange } from '../file-edit/events.js';

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

    // Phase 2: Ensure file was read before patching
    await assertFileReadBeforeWrite(ctx, resolved, rel);

    const lock = await ctx.writeLock(resolved);
    try {
      const rawContent = await Bun.file(resolved).text();
      // Phase 5: Normalize line endings before splitting
      const content = normalizeLineEndings(rawContent);
      const lines = content.split('\n');
      const totalLines = lines.length;

      // Phase 5: Validate patch bounds
      for (const patch of input.patches) {
        if (patch.startLine < 1) {
          throw new Error(
            `Invalid patch: startLine (${patch.startLine}) must be >= 1.`
          );
        }
        if (patch.endLine > totalLines) {
          throw new Error(
            `Invalid patch: endLine (${patch.endLine}) exceeds file length (${totalLines} lines).`
          );
        }
        if (patch.startLine > patch.endLine) {
          throw new Error(
            `Invalid patch: startLine (${patch.startLine}) > endLine (${patch.endLine}).`
          );
        }
      }

      // Sort patches by startLine ascending for overlap detection
      const sortedAsc = [...input.patches].sort((a, b) => a.startLine - b.startLine);

      // Phase 5: Check for overlapping patches
      for (let i = 0; i < sortedAsc.length - 1; i++) {
        const current = sortedAsc[i];
        const next = sortedAsc[i + 1];
        if (current.endLine >= next.startLine) {
          throw new Error(
            `Overlapping patches detected: patch at lines ${current.startLine}-${current.endLine} ` +
            `overlaps with patch at lines ${next.startLine}-${next.endLine}. ` +
            `Merge overlapping patches into a single patch.`
          );
        }
      }

      // Apply patches from bottom up (descending startLine) to preserve line indices
      const sorted = [...input.patches].sort((a, b) => b.startLine - a.startLine);

      for (const patch of sorted) {
        const start = patch.startLine - 1;
        const end = patch.endLine;
        const replacement = normalizeLineEndings(patch.content).split('\n');
        lines.splice(start, end - start, ...replacement);
      }

      const newContent = lines.join('\n');
      await Bun.write(resolved, newContent);

      // Update read timestamp after our own write
      ctx.fileReadTimestamps.set(resolved, Date.now());

      // Phase 4: Generate diff
      const diff = generateUnifiedDiff(rel, content, newContent);
      const stats = computeDiffStats(content, newContent);

      // Phase 7: Emit file change event
      const patchedFile = Bun.file(resolved);
      emitFileChange(ctx.emitMetadata, {
        type: 'modified',
        path: rel,
        resolvedPath: resolved,
        mtime: patchedFile.lastModified,
        additions: stats.additions,
        deletions: stats.deletions,
      });

      return {
        result: diff,
        metadata: {
          path: rel,
          patchCount: input.patches.length,
          diff,
          additions: stats.additions,
          deletions: stats.deletions,
        },
      };
    } finally {
      lock.release();
    }
  },
};

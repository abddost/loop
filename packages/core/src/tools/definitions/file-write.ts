/**
 * file-write tool -- writes content to a file in the workspace.
 *
 * If the file already exists, the LLM must have read it first (prevents
 * accidental overwrites). Generates a diff for existing file modifications.
 */

import { z } from 'zod';
import { mkdir } from 'node:fs/promises';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { assertExternalDirectory } from '../assert-external-directory.js';
import { assertFileReadBeforeWrite } from '../file-edit/file-time.js';
import { isBinaryFile, describeBinaryFile } from '../file-edit/binary-detect.js';
import { generateUnifiedDiff, computeDiffStats } from '../file-edit/diff.js';
import { emitFileChange } from '../file-edit/events.js';

const inputSchema = z.object({
  path: z.string().describe('Path to write to (relative to workspace root)'),
  contents: z.string().describe('Content to write to the file'),
});

type Input = z.infer<typeof inputSchema>;

/**
 * Check if a file exists without throwing.
 */
async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

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

    const resolved = resolve(filePath);
    const rel = relative(ctx.workspaceRootPath, resolved);

    await assertExternalDirectory(ctx, resolved);
    await ctx.ask({
      permission: 'edit',
      patterns: [rel.startsWith('..') ? resolved : rel],
      always: ['*'],
      metadata: { toolName: 'file-write', filepath: resolved, path: rel },
    });

    // Acquire write lock
    const lock = await ctx.writeLock(resolved);
    try {
      const exists = await fileExists(resolved);

      // Phase 3: Warn about binary file overwrite
      if (exists && await isBinaryFile(resolved)) {
        const fileSize = Bun.file(resolved).size;
        const desc = describeBinaryFile(resolved, fileSize);
        // Allow but warn — some workflows need to overwrite binary files
        const warning = `Warning: Overwriting existing binary file ${desc}. `;
        // Still proceed with the write

        await mkdir(dirname(resolved), { recursive: true });
        await Bun.write(resolved, input.contents);

        // Update read timestamp
        ctx.fileReadTimestamps.set(resolved, Date.now());

        // Emit file change
        const newFile = Bun.file(resolved);
        emitFileChange(ctx.emitMetadata, {
          type: 'modified',
          path: rel,
          resolvedPath: resolved,
          mtime: newFile.lastModified,
        });

        return {
          result: `${warning}Wrote ${input.contents.length} bytes to ${rel}`,
          metadata: {
            bytesWritten: input.contents.length,
            path: rel,
            binaryOverwrite: true,
          },
        };
      }

      // Phase 2: If file exists, ensure it was read first
      if (exists) {
        await assertFileReadBeforeWrite(ctx, resolved, rel);
      }

      // Read old content for diff generation (if file exists)
      let oldContent: string | null = null;
      if (exists) {
        try {
          oldContent = await Bun.file(resolved).text();
        } catch {
          // If we can't read it, proceed without diff
        }
      }

      // Ensure parent directory exists
      await mkdir(dirname(resolved), { recursive: true });

      // Write file
      await Bun.write(resolved, input.contents);

      // Update read timestamp after our own write
      ctx.fileReadTimestamps.set(resolved, Date.now());

      // Phase 7: Emit file change event
      const changeType = exists ? 'modified' as const : 'created' as const;
      const newBunFile = Bun.file(resolved);

      // Phase 4: Generate diff if we had old content
      if (oldContent !== null) {
        const diff = generateUnifiedDiff(rel, oldContent, input.contents);
        const stats = computeDiffStats(oldContent, input.contents);

        emitFileChange(ctx.emitMetadata, {
          type: changeType,
          path: rel,
          resolvedPath: resolved,
          mtime: newBunFile.lastModified,
          additions: stats.additions,
          deletions: stats.deletions,
        });

        return {
          result: diff,
          metadata: {
            bytesWritten: input.contents.length,
            path: rel,
            diff,
            additions: stats.additions,
            deletions: stats.deletions,
            created: !exists,
          },
        };
      }

      // Generate a synthetic diff for new files so the UI can display
      // all written lines as additions (instead of showing nothing).
      const newFileDiff = generateUnifiedDiff(rel, '', input.contents);
      const newFileStats = computeDiffStats('', input.contents);

      emitFileChange(ctx.emitMetadata, {
        type: changeType,
        path: rel,
        resolvedPath: resolved,
        mtime: newBunFile.lastModified,
        additions: newFileStats.additions,
        deletions: newFileStats.deletions,
      });

      return {
        result: newFileDiff,
        metadata: {
          bytesWritten: input.contents.length,
          path: rel,
          diff: newFileDiff,
          additions: newFileStats.additions,
          deletions: newFileStats.deletions,
          created: true,
        },
      };
    } finally {
      lock.release();
    }
  },
};

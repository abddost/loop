/**
 * File-time assertions -- ensure files are read before being written,
 * and that external modifications are detected.
 *
 * Prevents two classes of data loss:
 * 1. LLM blindly overwriting a file it never read
 * 2. LLM overwriting changes made externally since the last read
 */

import { stat } from 'node:fs/promises';
import type { ToolExecCtx } from '../types.js';

/**
 * Assert that a file was read before writing, and that it hasn't been
 * modified externally since the last read.
 *
 * @throws Error if the file was never read or was modified since last read
 */
export async function assertFileReadBeforeWrite(
  ctx: ToolExecCtx,
  resolvedPath: string,
  relPath: string,
): Promise<void> {
  const readTimestamp = ctx.fileReadTimestamps.get(resolvedPath);

  if (readTimestamp === undefined) {
    throw new Error(
      `You must read "${relPath}" before editing it. ` +
      `Use the file-read tool first to view the current contents.`
    );
  }

  // Check if the file has been modified externally since last read
  try {
    const fileStat = await stat(resolvedPath);
    const mtime = fileStat.mtimeMs;

    if (mtime > readTimestamp) {
      throw new Error(
        `File "${relPath}" has been modified since it was last read ` +
        `(read at ${new Date(readTimestamp).toISOString()}, ` +
        `modified at ${new Date(mtime).toISOString()}). ` +
        `Re-read the file before editing to see the latest content.`
      );
    }
  } catch (err: unknown) {
    // If stat fails (file deleted), let the edit tool handle the missing file
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `File "${relPath}" no longer exists. It may have been deleted since it was last read.`
      );
    }
    // Re-throw our own assertion errors
    if (err instanceof Error && err.message.includes('has been modified since')) {
      throw err;
    }
    // Ignore other stat errors — let the write proceed
  }
}

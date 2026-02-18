/**
 * file-read tool -- reads file contents from the workspace.
 *
 * Handles binary file detection, per-line truncation for minified files,
 * and output size limits to prevent token budget blowout.
 */

import { z } from 'zod';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { isBinaryFile, isImageByExtension, describeBinaryFile } from '../file-edit/binary-detect.js';
import { normalizeLineEndings } from '../file-edit/replacers.js';

const inputSchema = z.object({
  path: z.string().describe('Path to the file to read (relative to workspace root)'),
  offset: z.number().optional().describe('Line number to start reading from (1-indexed)'),
  limit: z.number().optional().describe('Number of lines to read'),
});

type Input = z.infer<typeof inputSchema>;

/** Maximum characters per line before truncation. */
const MAX_LINE_LENGTH = 2000;

/** Maximum total output size in bytes (~50KB). */
const MAX_OUTPUT_BYTES = 50 * 1024;

/**
 * Truncate a line if it exceeds the maximum length.
 */
function truncateLine(line: string): string {
  if (line.length > MAX_LINE_LENGTH) {
    return line.slice(0, MAX_LINE_LENGTH) + '... [truncated]';
  }
  return line;
}

/**
 * Format lines with line numbers and apply output size limit.
 */
function formatLines(
  lines: string[],
  startLineNumber: number,
  totalLines: number,
): { output: string; truncated: boolean; returnedLines: number } {
  const formatted: string[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = startLineNumber + i;
    const line = truncateLine(lines[i]);
    const formatted_line = `${String(lineNum).padStart(6)}|${line}`;
    const lineBytes = Buffer.byteLength(formatted_line, 'utf-8') + 1; // +1 for newline

    if (totalBytes + lineBytes > MAX_OUTPUT_BYTES) {
      truncated = true;
      formatted.push(
        `\n... [output truncated at ${i} of ${totalLines} lines. Use offset/limit to read specific sections.]`
      );
      break;
    }

    formatted.push(formatted_line);
    totalBytes += lineBytes;
  }

  return {
    output: formatted.join('\n'),
    truncated,
    returnedLines: Math.min(formatted.length, lines.length),
  };
}

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

    // Check file exists and size
    const bunFile = Bun.file(resolved);
    const fileSize = bunFile.size;
    if (fileSize > 10 * 1024 * 1024) {
      throw new Error('File is too large (>10MB). Use offset and limit to read portions.');
    }

    // Phase 3: Binary file detection
    if (await isBinaryFile(resolved)) {
      // Still record read timestamp so the LLM knows it "saw" the file
      ctx.fileReadTimestamps.set(resolved, Date.now());

      const isImage = isImageByExtension(resolved);
      const description = describeBinaryFile(resolved, fileSize);

      return {
        result: description,
        metadata: {
          binary: true,
          image: isImage,
          bytesRead: fileSize,
          path: rel,
        },
      };
    }

    const rawContent = await bunFile.text();
    const content = normalizeLineEndings(rawContent);

    // Record read timestamp
    ctx.fileReadTimestamps.set(resolved, Date.now());

    const allLines = content.split('\n');
    const totalLines = allLines.length;

    // Apply offset/limit
    if (input.offset !== undefined || input.limit !== undefined) {
      const start = (input.offset ?? 1) - 1;
      const end = input.limit ? start + input.limit : allLines.length;
      const sliced = allLines.slice(Math.max(0, start), end);

      const { output, truncated, returnedLines } = formatLines(
        sliced,
        Math.max(0, start) + 1,
        totalLines,
      );

      return {
        result: output,
        metadata: {
          bytesRead: fileSize,
          totalLines,
          returnedLines,
          truncated,
        },
      };
    }

    // Full file read
    const { output, truncated, returnedLines } = formatLines(allLines, 1, totalLines);

    return {
      result: output,
      metadata: {
        bytesRead: fileSize,
        totalLines,
        returnedLines,
        truncated,
      },
    };
  },
};

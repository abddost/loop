/**
 * Unit tests for file-patch validation (overlap detection, bounds checking).
 * Tests the validation logic that's now built into the file-patch tool.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { definition } from '../../definitions/file-patch';
import type { ToolExecCtx } from '../../types';

const TEST_DIR = join(tmpdir(), 'patch-test-' + Date.now());

function makeCtx(): ToolExecCtx {
  const timestamps = new Map<string, number>();
  return {
    workspaceId: 'test',
    workspaceRootPath: TEST_DIR,
    sessionId: 'test-session',
    abort: new AbortController().signal,
    config: {},
    fileReadTimestamps: timestamps,
    writeLock: async () => ({ release: () => {} }),
    processSpawn: () => {},
  };
}

describe('file-patch validation', () => {
  const testFile = 'test.txt';
  const testFilePath = join(TEST_DIR, testFile);

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(testFilePath, 'line 1\nline 2\nline 3\nline 4\nline 5\n', 'utf-8');
  });

  test('detects overlapping patches', async () => {
    const ctx = makeCtx();
    // Mark file as read
    ctx.fileReadTimestamps.set(testFilePath, Date.now());

    await expect(
      definition.execute(
        {
          path: testFile,
          patches: [
            { startLine: 1, endLine: 3, content: 'new 1-3' },
            { startLine: 2, endLine: 4, content: 'new 2-4' }, // Overlaps with first
          ],
        },
        ctx,
      )
    ).rejects.toThrow('Overlapping patches');
  });

  test('rejects startLine < 1', async () => {
    const ctx = makeCtx();
    ctx.fileReadTimestamps.set(testFilePath, Date.now());

    await expect(
      definition.execute(
        {
          path: testFile,
          patches: [
            { startLine: 0, endLine: 2, content: 'new' },
          ],
        },
        ctx,
      )
    ).rejects.toThrow('startLine (0) must be >= 1');
  });

  test('rejects endLine > total lines', async () => {
    const ctx = makeCtx();
    ctx.fileReadTimestamps.set(testFilePath, Date.now());

    await expect(
      definition.execute(
        {
          path: testFile,
          patches: [
            { startLine: 1, endLine: 100, content: 'new' },
          ],
        },
        ctx,
      )
    ).rejects.toThrow('exceeds file length');
  });

  test('rejects startLine > endLine', async () => {
    const ctx = makeCtx();
    ctx.fileReadTimestamps.set(testFilePath, Date.now());

    await expect(
      definition.execute(
        {
          path: testFile,
          patches: [
            { startLine: 5, endLine: 2, content: 'new' },
          ],
        },
        ctx,
      )
    ).rejects.toThrow('startLine (5) > endLine (2)');
  });

  test('applies valid non-overlapping patches', async () => {
    const ctx = makeCtx();
    ctx.fileReadTimestamps.set(testFilePath, Date.now());

    const result = await definition.execute(
      {
        path: testFile,
        patches: [
          { startLine: 1, endLine: 1, content: 'modified line 1' },
          { startLine: 4, endLine: 4, content: 'modified line 4' },
        ],
      },
      ctx,
    );

    // Should succeed and return diff
    expect(result.result).toContain('-line 1');
    expect(result.result).toContain('+modified line 1');

    const newContent = await readFile(testFilePath, 'utf-8');
    expect(newContent).toContain('modified line 1');
    expect(newContent).toContain('modified line 4');
    expect(newContent).toContain('line 2'); // Unchanged
  });

  test('handles CRLF line endings', async () => {
    await writeFile(testFilePath, 'line 1\r\nline 2\r\nline 3\r\n', 'utf-8');
    const ctx = makeCtx();
    ctx.fileReadTimestamps.set(testFilePath, Date.now());

    const result = await definition.execute(
      {
        path: testFile,
        patches: [
          { startLine: 2, endLine: 2, content: 'modified line 2' },
        ],
      },
      ctx,
    );

    expect(result.metadata?.patchCount).toBe(1);
    const newContent = await readFile(testFilePath, 'utf-8');
    expect(newContent).toContain('modified line 2');
  });
});

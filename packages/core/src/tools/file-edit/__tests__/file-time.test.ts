/**
 * Unit tests for file-time assertions (read-before-write).
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { assertFileReadBeforeWrite } from '../file-time';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolExecCtx } from '../../types';

const TEST_DIR = join(tmpdir(), 'file-time-test-' + Date.now());
const TEST_FILE = join(TEST_DIR, 'test.txt');

function makeCtx(timestamps?: Map<string, number>): ToolExecCtx {
  return {
    workspaceId: 'test',
    workspaceRootPath: TEST_DIR,
    sessionId: 'test-session',
    abort: new AbortController().signal,
    config: {},
    fileReadTimestamps: timestamps ?? new Map(),
    writeLock: async () => ({ release: () => {} }),
    processSpawn: () => {},
  };
}

describe('assertFileReadBeforeWrite', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(TEST_FILE, 'test content', 'utf-8');
  });

  test('throws when file was never read', async () => {
    const ctx = makeCtx();

    await expect(
      assertFileReadBeforeWrite(ctx, TEST_FILE, 'test.txt')
    ).rejects.toThrow('must read');
  });

  test('passes when file was read and not modified externally', async () => {
    const timestamps = new Map<string, number>();
    timestamps.set(TEST_FILE, Date.now());
    const ctx = makeCtx(timestamps);

    // Should not throw
    await assertFileReadBeforeWrite(ctx, TEST_FILE, 'test.txt');
  });

  test('throws when file was modified after read', async () => {
    const timestamps = new Map<string, number>();
    // Set read timestamp to the past
    timestamps.set(TEST_FILE, Date.now() - 5000);
    const ctx = makeCtx(timestamps);

    // Modify the file after the "read"
    await writeFile(TEST_FILE, 'modified content', 'utf-8');

    await expect(
      assertFileReadBeforeWrite(ctx, TEST_FILE, 'test.txt')
    ).rejects.toThrow('has been modified since');
  });

  test('throws when file was deleted after read', async () => {
    const timestamps = new Map<string, number>();
    timestamps.set(TEST_FILE, Date.now());
    const ctx = makeCtx(timestamps);

    await unlink(TEST_FILE);

    await expect(
      assertFileReadBeforeWrite(ctx, TEST_FILE, 'test.txt')
    ).rejects.toThrow('no longer exists');
  });
});

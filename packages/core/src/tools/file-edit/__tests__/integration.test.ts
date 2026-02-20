/**
 * Integration tests -- full edit cycle: read → edit (with fuzzy match) → verify diff output.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { definition as fileRead } from '../../definitions/file-read';
import { definition as fileEdit } from '../../definitions/file-edit';
import { definition as fileWrite } from '../../definitions/file-write';
import type { ToolExecCtx } from '../../types';

const TEST_DIR = join(tmpdir(), 'integration-test-' + Date.now());

function makeCtx(): ToolExecCtx {
  return {
    workspaceId: 'test',
    workspaceRootPath: TEST_DIR,
    sessionId: 'test-session',
    abort: new AbortController().signal,
    config: {},
    fileReadTimestamps: new Map(),
    writeLock: async () => ({ release: () => {} }),
    processSpawn: () => {},
  };
}

describe('Integration: Read → Edit → Verify', () => {
  const testFile = 'src/app.ts';

  beforeEach(async () => {
    await mkdir(join(TEST_DIR, 'src'), { recursive: true });
    await writeFile(
      join(TEST_DIR, testFile),
      [
        'import { Logger } from "./logger";',
        '',
        'export function main() {',
        '  const logger = new Logger();',
        '  logger.info("Starting app");',
        '  // TODO: add initialization',
        '  return true;',
        '}',
      ].join('\n'),
      'utf-8',
    );
  });

  test('full cycle: read, exact edit, verify diff', async () => {
    const ctx = makeCtx();

    // Step 1: Read the file
    const readResult = await fileRead.execute({ path: testFile }, ctx);
    expect(readResult.metadata?.totalLines).toBe(8);

    // Step 2: Edit with exact match
    const editResult = await fileEdit.execute(
      {
        path: testFile,
        old_string: '  // TODO: add initialization',
        new_string: '  initialize();\n  logger.info("Initialized");',
        replace_all: false,
      },
      ctx,
    );

    // Step 3: Verify diff output
    expect(editResult.result).toContain('-  // TODO: add initialization');
    expect(editResult.result).toContain('+  initialize();');
    expect(editResult.metadata?.strategy).toBe('exact');
    expect(editResult.metadata?.additions).toBeGreaterThan(0);

    // Step 4: Verify file content
    const content = await readFile(join(TEST_DIR, testFile), 'utf-8');
    expect(content).toContain('initialize();');
    expect(content).toContain('logger.info("Initialized")');
    expect(content).not.toContain('TODO');
  });

  test('full cycle: read, fuzzy edit (indentation mismatch), verify', async () => {
    const ctx = makeCtx();

    // Step 1: Read
    await fileRead.execute({ path: testFile }, ctx);

    // Step 2: Edit with wrong indentation (4 spaces instead of 2)
    const editResult = await fileEdit.execute(
      {
        path: testFile,
        old_string: '    const logger = new Logger();\n    logger.info("Starting app");',
        new_string: '  const log = new Logger("app");\n  log.info("Starting app");',
        replace_all: false,
      },
      ctx,
    );

    // Should use fuzzy matching
    expect(editResult.metadata?.fuzzyMatch).toBe(true);

    // Verify file content
    const content = await readFile(join(TEST_DIR, testFile), 'utf-8');
    expect(content).toContain('const log = new Logger("app")');
  });

  test('edit without read throws', async () => {
    const ctx = makeCtx();

    await expect(
      fileEdit.execute(
        {
          path: testFile,
          old_string: 'anything',
          new_string: 'else',
          replace_all: false,
        },
        ctx,
      )
    ).rejects.toThrow('must read');
  });

  test('write to existing file without read throws', async () => {
    const ctx = makeCtx();

    await expect(
      fileWrite.execute(
        {
          path: testFile,
          contents: 'overwrite everything',
        },
        ctx,
      )
    ).rejects.toThrow('must read');
  });

  test('write to new file succeeds without read', async () => {
    const ctx = makeCtx();

    const result = await fileWrite.execute(
      {
        path: 'src/new-file.ts',
        contents: 'export const x = 1;',
      },
      ctx,
    );

    // New files now return a unified diff (all additions) instead of plain text
    expect(result.result).toContain('+export const x = 1;');
    expect(result.metadata?.created).toBe(true);
  });

  test('read → write to existing file returns diff', async () => {
    const ctx = makeCtx();

    // Read first
    await fileRead.execute({ path: testFile }, ctx);

    // Write new content
    const result = await fileWrite.execute(
      {
        path: testFile,
        contents: 'export function main() { return false; }',
      },
      ctx,
    );

    // Should return diff since file existed
    expect(result.result).toContain('-');
    expect(result.result).toContain('+');
    expect(result.metadata?.diff).toBeTruthy();
    expect(result.metadata?.additions).toBeDefined();
    expect(result.metadata?.deletions).toBeDefined();
  });

  test('old_string === new_string throws', async () => {
    const ctx = makeCtx();
    await fileRead.execute({ path: testFile }, ctx);

    await expect(
      fileEdit.execute(
        {
          path: testFile,
          old_string: 'return true;',
          new_string: 'return true;',
          replace_all: false,
        },
        ctx,
      )
    ).rejects.toThrow('identical');
  });
});

describe('Integration: Binary file handling', () => {
  test('read binary file returns description instead of content', async () => {
    const ctx = makeCtx();
    const binaryFile = 'assets/logo.png';
    await mkdir(join(TEST_DIR, 'assets'), { recursive: true });

    // Write some binary-like content
    const buffer = Buffer.alloc(100);
    buffer[0] = 0x89; // PNG signature byte
    buffer[1] = 0x50;
    buffer[2] = 0x4E;
    buffer[3] = 0x47;
    buffer[10] = 0x00; // Null byte
    await writeFile(join(TEST_DIR, binaryFile), buffer);

    const result = await fileRead.execute({ path: binaryFile }, ctx);
    expect(result.result).toContain('[Binary file:');
    expect(result.metadata?.binary).toBe(true);
  });

  test('edit binary file throws', async () => {
    const ctx = makeCtx();
    const binaryFile = 'assets/icon.png';
    await mkdir(join(TEST_DIR, 'assets'), { recursive: true });
    await writeFile(join(TEST_DIR, binaryFile), Buffer.alloc(50));

    // Mark as read
    ctx.fileReadTimestamps.set(join(TEST_DIR, binaryFile), Date.now());

    await expect(
      fileEdit.execute(
        {
          path: binaryFile,
          old_string: 'x',
          new_string: 'y',
          replace_all: false,
        },
        ctx,
      )
    ).rejects.toThrow('Cannot edit binary file');
  });
});

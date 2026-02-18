/**
 * Unit tests for diff generation utilities.
 */

import { describe, test, expect } from 'bun:test';
import { generateUnifiedDiff, computeDiffStats, trimDiff } from '../diff';

describe('generateUnifiedDiff', () => {
  test('generates diff for single line change', () => {
    const old = 'line 1\nline 2\nline 3\n';
    const new_ = 'line 1\nmodified line 2\nline 3\n';
    const diff = generateUnifiedDiff('test.ts', old, new_);

    expect(diff).toContain('---');
    expect(diff).toContain('+++');
    expect(diff).toContain('-line 2');
    expect(diff).toContain('+modified line 2');
  });

  test('generates diff for addition', () => {
    const old = 'line 1\nline 3\n';
    const new_ = 'line 1\nline 2\nline 3\n';
    const diff = generateUnifiedDiff('test.ts', old, new_);

    expect(diff).toContain('+line 2');
  });

  test('generates diff for deletion', () => {
    const old = 'line 1\nline 2\nline 3\n';
    const new_ = 'line 1\nline 3\n';
    const diff = generateUnifiedDiff('test.ts', old, new_);

    expect(diff).toContain('-line 2');
  });

  test('returns minimal diff for identical content', () => {
    const content = 'hello\nworld\n';
    const diff = generateUnifiedDiff('test.ts', content, content);

    // Should not contain diff hunks (lines starting with - or + after hunk headers)
    const lines = diff.split('\n');
    const hunkLines = lines.filter(
      l => (l.startsWith('-') || l.startsWith('+')) && !l.startsWith('---') && !l.startsWith('+++')
    );
    expect(hunkLines.length).toBe(0);
  });
});

describe('computeDiffStats', () => {
  test('counts additions', () => {
    const old = 'line 1\n';
    const new_ = 'line 1\nline 2\nline 3\n';
    const stats = computeDiffStats(old, new_);

    expect(stats.additions).toBeGreaterThan(0);
    expect(stats.deletions).toBe(0);
  });

  test('counts deletions', () => {
    const old = 'line 1\nline 2\nline 3\n';
    const new_ = 'line 1\n';
    const stats = computeDiffStats(old, new_);

    expect(stats.deletions).toBeGreaterThan(0);
    expect(stats.additions).toBe(0);
  });

  test('counts both additions and deletions', () => {
    const old = 'line 1\nline 2\n';
    const new_ = 'line 1\nmodified\n';
    const stats = computeDiffStats(old, new_);

    expect(stats.additions).toBeGreaterThan(0);
    expect(stats.deletions).toBeGreaterThan(0);
  });

  test('returns zero for identical content', () => {
    const content = 'hello\nworld\n';
    const stats = computeDiffStats(content, content);

    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(0);
  });
});

describe('trimDiff', () => {
  test('preserves header lines', () => {
    const diff = '--- a/test.ts\n+++ b/test.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n';
    const trimmed = trimDiff(diff);

    expect(trimmed).toContain('--- a/test.ts');
    expect(trimmed).toContain('+++ b/test.ts');
    expect(trimmed).toContain('@@ -1,2 +1,2 @@');
  });

  test('strips common indentation from body', () => {
    const diff = '--- a\n+++ b\n@@ -1 +1 @@\n-    indented\n+    also indented\n';
    const trimmed = trimDiff(diff);

    // The common 4-space indent should be stripped
    expect(trimmed).toContain('-indented');
    expect(trimmed).toContain('+also indented');
  });

  test('handles empty diff', () => {
    expect(trimDiff('')).toBe('');
  });
});

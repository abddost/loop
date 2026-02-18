/**
 * Unified diff generation for file operations.
 *
 * Every write operation generates a diff so:
 * 1. The LLM can verify the change was correct
 * 2. The UI can display rich diffs
 * 3. Permission requests show what will change
 */

import { createTwoFilesPatch, diffLines } from 'diff';

/**
 * Generate a unified diff between old and new content.
 */
export function generateUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
): string {
  return createTwoFilesPatch(
    filePath,
    filePath,
    oldContent,
    newContent,
    'original',
    'modified',
    { context: 3 },
  );
}

/**
 * Compute addition/deletion counts from a content change.
 */
export function computeDiffStats(
  oldContent: string,
  newContent: string,
): { additions: number; deletions: number } {
  const changes = diffLines(oldContent, newContent);
  let additions = 0;
  let deletions = 0;

  for (const change of changes) {
    const lineCount = change.count ?? 0;
    if (change.added) {
      additions += lineCount;
    } else if (change.removed) {
      deletions += lineCount;
    }
  }

  return { additions, deletions };
}

/**
 * Trim a diff string by stripping common leading whitespace
 * from diff body lines for readability.
 */
export function trimDiff(diff: string): string {
  const lines = diff.split('\n');

  // Find the body lines (skip headers starting with ---, +++, @@)
  const bodyLines = lines.filter(
    l => !l.startsWith('---') && !l.startsWith('+++') && !l.startsWith('@@') && !l.startsWith('diff')
  );

  if (bodyLines.length === 0) return diff;

  // Find minimum leading whitespace in non-empty body lines (after the +/- prefix)
  let minIndent = Infinity;
  for (const line of bodyLines) {
    if (line.length <= 1) continue; // Skip empty diff lines
    const content = line.slice(1); // Remove +/- / space prefix
    const stripped = content.replace(/^\s+/, '');
    if (stripped.length > 0) {
      minIndent = Math.min(minIndent, content.length - stripped.length);
    }
  }

  if (minIndent === Infinity || minIndent === 0) return diff;

  // Strip the common indent from body lines
  return lines
    .map(line => {
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@') || line.startsWith('diff')) {
        return line;
      }
      if (line.length <= 1) return line;
      const prefix = line[0];
      const content = line.slice(1);
      return prefix + content.slice(Math.min(minIndent, content.length));
    })
    .join('\n');
}

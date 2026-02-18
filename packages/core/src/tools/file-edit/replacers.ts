/**
 * Fuzzy/progressive string matching for LLM-generated edits.
 *
 * LLMs generate imperfect old_string values ~20-30% of the time.
 * Instead of failing, we try 9 strategies in order from strictest
 * to loosest, each fixing a specific class of LLM mistake.
 */

// ─── Levenshtein Distance ──────────────────────────────────────────

/**
 * Compute the Levenshtein edit distance between two strings.
 * Used by block-anchor and context-aware strategies for similarity scoring.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use two rows instead of full matrix for O(n) space
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Compute similarity ratio (0..1) between two strings.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ─── Utilities ─────────────────────────────────────────────────────

/** Normalize CRLF → LF */
export function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ─── Replacer Types ────────────────────────────────────────────────

export interface ReplaceMatch {
  /** The strategy name that produced this match */
  strategy: string;
  /** Index in the content where the match starts */
  start: number;
  /** Index in the content where the match ends */
  end: number;
  /** The actual matched text from the content */
  matched: string;
}

type Replacer = (content: string, find: string) => Generator<ReplaceMatch>;

// ─── Strategy 1: Exact Match (SimpleReplacer) ──────────────────────

function* simpleReplacer(content: string, find: string): Generator<ReplaceMatch> {
  let pos = 0;
  while (true) {
    const idx = content.indexOf(find, pos);
    if (idx === -1) break;
    yield {
      strategy: 'exact',
      start: idx,
      end: idx + find.length,
      matched: content.slice(idx, idx + find.length),
    };
    pos = idx + 1;
  }
}

// ─── Strategy 2: Line-Trimmed (trailing whitespace per line) ───────

function* lineTrimmedReplacer(content: string, find: string): Generator<ReplaceMatch> {
  const findLines = find.split('\n').map(l => l.trimEnd());
  const contentLines = content.split('\n');

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    let match = true;
    for (let j = 0; j < findLines.length; j++) {
      if (contentLines[i + j].trimEnd() !== findLines[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      // Calculate byte positions
      let start = 0;
      for (let k = 0; k < i; k++) start += contentLines[k].length + 1;
      let end = start;
      for (let k = 0; k < findLines.length; k++) {
        end += contentLines[i + k].length;
        if (k < findLines.length - 1) end += 1; // newline
      }
      yield {
        strategy: 'line-trimmed',
        start,
        end,
        matched: contentLines.slice(i, i + findLines.length).join('\n'),
      };
    }
  }
}

// ─── Strategy 3: Block-Anchor (first/last lines match, middle ~similar) ──

function* blockAnchorReplacer(content: string, find: string): Generator<ReplaceMatch> {
  const findLines = find.split('\n');
  if (findLines.length < 3) return; // Need at least 3 lines for anchor strategy

  const firstLine = findLines[0].trim();
  const lastLine = findLines[findLines.length - 1].trim();
  if (!firstLine || !lastLine) return;

  const contentLines = content.split('\n');

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue;
    const endIdx = i + findLines.length - 1;
    if (endIdx >= contentLines.length) continue;
    if (contentLines[endIdx].trim() !== lastLine) continue;

    // Check middle lines similarity (Levenshtein)
    let totalSim = 0;
    const middleCount = findLines.length - 2;
    for (let j = 1; j <= middleCount; j++) {
      totalSim += similarity(
        contentLines[i + j].trim(),
        findLines[j].trim()
      );
    }
    const avgSim = middleCount > 0 ? totalSim / middleCount : 1;

    if (avgSim >= 0.6) {
      let start = 0;
      for (let k = 0; k < i; k++) start += contentLines[k].length + 1;
      let end = start;
      for (let k = 0; k < findLines.length; k++) {
        end += contentLines[i + k].length;
        if (k < findLines.length - 1) end += 1;
      }
      yield {
        strategy: 'block-anchor',
        start,
        end,
        matched: contentLines.slice(i, i + findLines.length).join('\n'),
      };
    }
  }
}

// ─── Strategy 4: Whitespace-Normalized ─────────────────────────────

function normalizeWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, ' ');
}

function* whitespaceNormalizedReplacer(content: string, find: string): Generator<ReplaceMatch> {
  const findLines = find.split('\n').map(l => normalizeWhitespace(l.trim()));
  const contentLines = content.split('\n');

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    let match = true;
    for (let j = 0; j < findLines.length; j++) {
      if (normalizeWhitespace(contentLines[i + j].trim()) !== findLines[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      let start = 0;
      for (let k = 0; k < i; k++) start += contentLines[k].length + 1;
      let end = start;
      for (let k = 0; k < findLines.length; k++) {
        end += contentLines[i + k].length;
        if (k < findLines.length - 1) end += 1;
      }
      yield {
        strategy: 'whitespace-normalized',
        start,
        end,
        matched: contentLines.slice(i, i + findLines.length).join('\n'),
      };
    }
  }
}

// ─── Strategy 5: Indentation-Flexible ──────────────────────────────

function stripIndent(line: string): { indent: string; rest: string } {
  const match = line.match(/^([ \t]*)(.*)/);
  return { indent: match?.[1] ?? '', rest: match?.[2] ?? line };
}

function* indentationFlexibleReplacer(content: string, find: string): Generator<ReplaceMatch> {
  const findLines = find.split('\n');
  if (findLines.length === 0) return;

  const findStripped = findLines.map(l => stripIndent(l).rest);
  const contentLines = content.split('\n');

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    let match = true;
    for (let j = 0; j < findLines.length; j++) {
      if (stripIndent(contentLines[i + j]).rest !== findStripped[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      let start = 0;
      for (let k = 0; k < i; k++) start += contentLines[k].length + 1;
      let end = start;
      for (let k = 0; k < findLines.length; k++) {
        end += contentLines[i + k].length;
        if (k < findLines.length - 1) end += 1;
      }
      yield {
        strategy: 'indentation-flexible',
        start,
        end,
        matched: contentLines.slice(i, i + findLines.length).join('\n'),
      };
    }
  }
}

// ─── Strategy 6: Escape-Normalized ─────────────────────────────────

function normalizeEscapes(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function* escapeNormalizedReplacer(content: string, find: string): Generator<ReplaceMatch> {
  // Normalize escapes in the find string, then do exact search
  const normalizedFind = normalizeEscapes(find);
  if (normalizedFind === find) return; // No escapes to normalize, skip

  let pos = 0;
  while (true) {
    const idx = content.indexOf(normalizedFind, pos);
    if (idx === -1) break;
    yield {
      strategy: 'escape-normalized',
      start: idx,
      end: idx + normalizedFind.length,
      matched: content.slice(idx, idx + normalizedFind.length),
    };
    pos = idx + 1;
  }
}

// ─── Strategy 7: Trimmed-Boundary (extra blank lines at start/end) ─

function* trimmedBoundaryReplacer(content: string, find: string): Generator<ReplaceMatch> {
  // Trim leading/trailing empty lines from find
  const findLines = find.split('\n');
  let trimStart = 0;
  while (trimStart < findLines.length && findLines[trimStart].trim() === '') trimStart++;
  let trimEnd = findLines.length;
  while (trimEnd > trimStart && findLines[trimEnd - 1].trim() === '') trimEnd--;

  if (trimStart === 0 && trimEnd === findLines.length) return; // Nothing to trim
  const trimmedFind = findLines.slice(trimStart, trimEnd).join('\n');
  if (!trimmedFind) return;

  let pos = 0;
  while (true) {
    const idx = content.indexOf(trimmedFind, pos);
    if (idx === -1) break;
    yield {
      strategy: 'trimmed-boundary',
      start: idx,
      end: idx + trimmedFind.length,
      matched: content.slice(idx, idx + trimmedFind.length),
    };
    pos = idx + 1;
  }
}

// ─── Strategy 8: Context-Aware (anchors + 50% middle similarity) ───

function* contextAwareReplacer(content: string, find: string): Generator<ReplaceMatch> {
  const findLines = find.split('\n');
  if (findLines.length < 3) return; // Need >= 3 lines

  const firstTrimmed = findLines[0].trim();
  const lastTrimmed = findLines[findLines.length - 1].trim();
  if (!firstTrimmed || !lastTrimmed) return;

  const contentLines = content.split('\n');

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    if (contentLines[i].trim() !== firstTrimmed) continue;
    const endIdx = i + findLines.length - 1;
    if (endIdx >= contentLines.length) continue;
    if (contentLines[endIdx].trim() !== lastTrimmed) continue;

    // Require >= 50% of middle lines to be similar (threshold 0.5)
    const middleCount = findLines.length - 2;
    let matchingMiddle = 0;
    for (let j = 1; j <= middleCount; j++) {
      const sim = similarity(
        contentLines[i + j].trim(),
        findLines[j].trim()
      );
      if (sim >= 0.5) matchingMiddle++;
    }

    if (middleCount === 0 || matchingMiddle / middleCount >= 0.5) {
      let start = 0;
      for (let k = 0; k < i; k++) start += contentLines[k].length + 1;
      let end = start;
      for (let k = 0; k < findLines.length; k++) {
        end += contentLines[i + k].length;
        if (k < findLines.length - 1) end += 1;
      }
      yield {
        strategy: 'context-aware',
        start,
        end,
        matched: contentLines.slice(i, i + findLines.length).join('\n'),
      };
    }
  }
}

// ─── Strategy 9: Multi-Occurrence (for replaceAll) ─────────────────
// This is the same as simple but explicitly for the replaceAll case.
// It's last because earlier strategies should be tried first for unique matches.

// ─── Orchestrator ──────────────────────────────────────────────────

/** All strategies in priority order (strictest → loosest). */
const strategies: Replacer[] = [
  simpleReplacer,
  lineTrimmedReplacer,
  blockAnchorReplacer,
  whitespaceNormalizedReplacer,
  indentationFlexibleReplacer,
  escapeNormalizedReplacer,
  trimmedBoundaryReplacer,
  contextAwareReplacer,
];

export interface ReplaceResult {
  /** The new content after replacement */
  content: string;
  /** Which strategy was used */
  strategy: string;
  /** Whether this was an exact match (strategy 1) */
  exact: boolean;
}

/**
 * Try to find `oldStr` in `content` using progressive matching strategies.
 * Returns the content with the replacement applied, or throws if no match found.
 *
 * @param content - The file content
 * @param oldStr - The string to find (possibly imperfect from LLM)
 * @param newStr - The replacement string
 * @param replaceAll - Whether to replace all occurrences
 */
export function replace(
  content: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean = false,
): ReplaceResult {
  // Normalize line endings first
  content = normalizeLineEndings(content);
  oldStr = normalizeLineEndings(oldStr);
  newStr = normalizeLineEndings(newStr);

  for (const strategy of strategies) {
    const matches = Array.from(strategy(content, oldStr));

    if (matches.length === 0) continue;

    if (replaceAll) {
      // Replace all matches (apply from end to start to preserve indices)
      let result = content;
      const sorted = [...matches].sort((a, b) => b.start - a.start);
      for (const match of sorted) {
        result = result.slice(0, match.start) + newStr + result.slice(match.end);
      }
      return {
        content: result,
        strategy: matches[0].strategy,
        exact: matches[0].strategy === 'exact',
      };
    }

    // Single replacement: require unique match
    if (matches.length === 1) {
      const match = matches[0];
      const result = content.slice(0, match.start) + newStr + content.slice(match.end);
      return {
        content: result,
        strategy: match.strategy,
        exact: match.strategy === 'exact',
      };
    }

    // Multiple matches for single replacement — try next strategy for a unique match
    // But if this is the exact strategy, report the ambiguity
    if (matches[0].strategy === 'exact') {
      throw new Error(
        `old_string found ${matches.length} times. Use replace_all=true or provide more context to make it unique.`
      );
    }
    // For fuzzy strategies with multiple matches, skip to next strategy
    continue;
  }

  throw new Error(
    'old_string not found in file. Ensure it matches the file content (check whitespace and indentation).'
  );
}

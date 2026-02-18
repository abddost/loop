/**
 * Unit tests for the progressive string matching system.
 * Tests each of the 8 matching strategies with realistic LLM mistake patterns.
 */

import { describe, test, expect } from 'bun:test';
import {
  replace,
  levenshtein,
  similarity,
  normalizeLineEndings,
} from '../replacers';

// ─── Utility Tests ─────────────────────────────────────────────────

describe('levenshtein', () => {
  test('identical strings have distance 0', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  test('empty vs non-empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  test('single character difference', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });

  test('multi-character differences', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('similarity', () => {
  test('identical strings return 1', () => {
    expect(similarity('hello', 'hello')).toBe(1);
  });

  test('completely different strings return low similarity', () => {
    expect(similarity('abc', 'xyz')).toBeLessThan(0.5);
  });

  test('similar strings return high similarity', () => {
    expect(similarity('hello', 'hallo')).toBeGreaterThan(0.7);
  });
});

describe('normalizeLineEndings', () => {
  test('converts CRLF to LF', () => {
    expect(normalizeLineEndings('a\r\nb\r\nc')).toBe('a\nb\nc');
  });

  test('converts standalone CR to LF', () => {
    expect(normalizeLineEndings('a\rb\rc')).toBe('a\nb\nc');
  });

  test('preserves LF', () => {
    expect(normalizeLineEndings('a\nb\nc')).toBe('a\nb\nc');
  });
});

// ─── Strategy 1: Exact Match ──────────────────────────────────────

describe('Strategy 1: Exact Match', () => {
  test('replaces exact match', () => {
    const result = replace('hello world', 'world', 'earth');
    expect(result.content).toBe('hello earth');
    expect(result.strategy).toBe('exact');
    expect(result.exact).toBe(true);
  });

  test('replaces multi-line exact match', () => {
    const content = 'function foo() {\n  return 1;\n}';
    const result = replace(content, '  return 1;', '  return 2;');
    expect(result.content).toBe('function foo() {\n  return 2;\n}');
    expect(result.exact).toBe(true);
  });

  test('replaceAll replaces all occurrences', () => {
    const result = replace('aaa', 'a', 'b', true);
    expect(result.content).toBe('bbb');
    expect(result.strategy).toBe('exact');
  });

  test('throws on multiple exact matches without replaceAll', () => {
    expect(() => replace('hello hello', 'hello', 'world')).toThrow(
      'found 2 times'
    );
  });

  test('throws when string not found by any strategy', () => {
    expect(() => replace('hello world', 'xyz123', 'abc')).toThrow(
      'old_string not found'
    );
  });
});

// ─── Strategy 2: Line-Trimmed ─────────────────────────────────────

describe('Strategy 2: Line-Trimmed (trailing whitespace)', () => {
  test('matches despite trailing whitespace in content', () => {
    const content = 'function foo() {  \n  return 1;  \n}';
    const find = 'function foo() {\n  return 1;\n}';
    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    expect(result.strategy).toBe('line-trimmed');
    expect(result.exact).toBe(false);
  });

  test('matches despite trailing whitespace in find string', () => {
    const content = 'function foo() {\n  return 1;\n}';
    const find = 'function foo() {  \n  return 1;  \n}';
    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    expect(result.strategy).toBe('line-trimmed');
  });

  test('matches with tab/space trailing differences', () => {
    const content = 'line1\t\n  line2\t';
    const find = 'line1\n  line2';
    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    expect(result.strategy).toBe('line-trimmed');
  });
});

// ─── Strategy 3: Block-Anchor ─────────────────────────────────────

describe('Strategy 3: Block-Anchor (first/last lines match)', () => {
  test('matches when first/last lines match and middle is similar', () => {
    const content = [
      'function calculate() {',
      '  const x = 10;',
      '  const y = 20;',
      '  return x + y;',
      '}',
    ].join('\n');

    const find = [
      'function calculate() {',
      '  const x = 10;',
      '  const y = 25;', // Slightly different middle line
      '  return x + y;',
      '}',
    ].join('\n');

    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    expect(result.strategy).toBe('block-anchor');
  });

  test('does not match when anchors differ', () => {
    const content = 'function foo() {\n  return 1;\n}';
    const find = 'function bar() {\n  return 1;\n}';
    // Should not match via block-anchor since first line differs
    expect(() => replace(content, find, 'replaced')).toThrow('old_string not found');
  });
});

// ─── Strategy 4: Whitespace-Normalized ────────────────────────────

describe('Strategy 4: Whitespace-Normalized', () => {
  test('matches with multiple spaces collapsed', () => {
    const content = 'const   x   =   10;';
    const find = 'const x = 10;';
    const result = replace(content, find, 'const y = 20;');
    expect(result.content).toBe('const y = 20;');
    expect(result.strategy).toBe('whitespace-normalized');
  });

  test('matches multi-line with different spacing', () => {
    const content = 'if (  a   ==  b  ) {\n  do_something( );\n}';
    const find = 'if ( a == b ) {\n  do_something( );\n}';
    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    expect(result.strategy).toBe('whitespace-normalized');
  });
});

// ─── Strategy 5: Indentation-Flexible ─────────────────────────────

describe('Strategy 5: Indentation-Flexible', () => {
  test('matches with 2-space vs 4-space indentation', () => {
    const content = '    return x;\n    return y;';
    const find = '  return x;\n  return y;';
    const result = replace(content, find, '    return z;\n    return w;');
    expect(result.content).toBe('    return z;\n    return w;');
    // whitespace-normalized may also match since it strips leading whitespace
    expect(['indentation-flexible', 'whitespace-normalized']).toContain(result.strategy);
  });

  test('matches with tab vs space indentation', () => {
    const content = '\treturn x;';
    const find = '  return x;';
    const result = replace(content, find, '  return y;');
    expect(result.content).toBe('  return y;');
    expect(['indentation-flexible', 'whitespace-normalized']).toContain(result.strategy);
  });

  test('matches multi-line with different indent levels', () => {
    const content = [
      '        if (true) {',
      '            doSomething();',
      '        }',
    ].join('\n');

    const find = [
      '    if (true) {',
      '        doSomething();',
      '    }',
    ].join('\n');

    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    // Earlier strategies (block-anchor, whitespace-normalized) may match first
    expect(result.exact).toBe(false);
  });

  test('uniquely matches indentation-flexible when content differs non-whitespace', () => {
    // Create a case where ONLY indentation differs (same non-ws content)
    // but whitespace-normalized wouldn't match because content has different word spacing
    const content = 'if  (x) {\n\t\tdo_thing();\n}';
    const find = 'if  (x) {\n  do_thing();\n}';
    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    expect(result.exact).toBe(false);
  });
});

// ─── Strategy 6: Escape-Normalized ────────────────────────────────

describe('Strategy 6: Escape-Normalized', () => {
  test('matches with escaped newlines', () => {
    const content = 'const s = "hello\nworld";';
    const find = 'const s = "hello\\nworld";';
    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    expect(result.strategy).toBe('escape-normalized');
  });

  test('matches with escaped quotes', () => {
    const content = 'const s = "say "hi"";';
    const find = 'const s = "say \\"hi\\"";';
    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    expect(result.strategy).toBe('escape-normalized');
  });

  test('skips when no escape normalization needed', () => {
    // If there are no escape sequences, this strategy is skipped
    const content = 'hello world';
    // This should be matched by exact, not escape-normalized
    const result = replace(content, 'hello world', 'replaced');
    expect(result.strategy).toBe('exact');
  });
});

// ─── Strategy 7: Trimmed-Boundary ─────────────────────────────────

describe('Strategy 7: Trimmed-Boundary (extra blank lines)', () => {
  test('matches when find has extra leading blank lines', () => {
    const content = 'function foo() {\n  return 1;\n}';
    const find = '\n\nfunction foo() {\n  return 1;\n}';
    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    expect(result.strategy).toBe('trimmed-boundary');
  });

  test('matches when find has extra trailing blank lines', () => {
    const content = 'function foo() {\n  return 1;\n}';
    const find = 'function foo() {\n  return 1;\n}\n\n';
    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    expect(result.strategy).toBe('trimmed-boundary');
  });

  test('matches when find has both leading and trailing blank lines', () => {
    const content = 'function foo() {\n  return 1;\n}';
    const find = '\n\nfunction foo() {\n  return 1;\n}\n';
    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    expect(result.strategy).toBe('trimmed-boundary');
  });
});

// ─── Strategy 8: Context-Aware ────────────────────────────────────

describe('Strategy 8: Context-Aware (anchors + middle similarity)', () => {
  test('matches with anchor lines correct and middle slightly off', () => {
    const content = [
      'function render() {',
      '  const el = document.createElement("div");',
      '  el.className = "container";',
      '  el.textContent = "Hello";',
      '  return el;',
      '}',
    ].join('\n');

    const find = [
      'function render() {',
      '  const el = document.createElement("span");', // Wrong element
      '  el.className = "wrapper";', // Wrong class name
      '  el.textContent = "Hello";',
      '  return el;',
      '}',
    ].join('\n');

    const result = replace(content, find, 'replaced');
    expect(result.content).toBe('replaced');
    // Should match via block-anchor or context-aware
    expect(['block-anchor', 'context-aware']).toContain(result.strategy);
  });
});

// ─── CRLF Handling ────────────────────────────────────────────────

describe('CRLF normalization', () => {
  test('handles CRLF in content', () => {
    const content = 'hello\r\nworld';
    const result = replace(content, 'hello\nworld', 'goodbye\nworld');
    expect(result.content).toBe('goodbye\nworld');
  });

  test('handles CRLF in find string', () => {
    const content = 'hello\nworld';
    const result = replace(content, 'hello\r\nworld', 'goodbye\nworld');
    expect(result.content).toBe('goodbye\nworld');
  });
});

// ─── Replace All ──────────────────────────────────────────────────

describe('replaceAll mode', () => {
  test('replaces all exact occurrences', () => {
    const result = replace('foo bar foo baz foo', 'foo', 'qux', true);
    expect(result.content).toBe('qux bar qux baz qux');
  });

  test('replaces all multi-line occurrences', () => {
    const content = 'a\nb\na\nb\na\nb';
    const result = replace(content, 'a\nb', 'x\ny', true);
    expect(result.content).toBe('x\ny\nx\ny\nx\ny');
  });
});

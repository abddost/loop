/**
 * Wildcard pattern matching.
 *
 * `*` matches zero or more characters, `?` matches exactly one character.
 * Trailing ` *` in a pattern is treated as optional (matches with or without).
 */

export namespace Wildcard {
  export function match(str: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === str) return true;

    // Handle trailing " *" as optional (e.g. "ls *" matches "ls" and "ls -la")
    if (pattern.endsWith(' *') && str === pattern.slice(0, -2)) {
      return true;
    }

    let si = 0;
    let pi = 0;
    let starIdx = -1;
    let matchIdx = 0;

    while (si < str.length) {
      if (pi < pattern.length && (pattern[pi] === '?' || pattern[pi] === str[si])) {
        si++;
        pi++;
      } else if (pi < pattern.length && pattern[pi] === '*') {
        starIdx = pi;
        matchIdx = si;
        pi++;
      } else if (starIdx !== -1) {
        pi = starIdx + 1;
        matchIdx++;
        si = matchIdx;
      } else {
        return false;
      }
    }

    while (pi < pattern.length && pattern[pi] === '*') {
      pi++;
    }

    return pi === pattern.length;
  }
}

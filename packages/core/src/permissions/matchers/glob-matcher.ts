/**
 * Glob pattern matcher for permission scopes.
 */

export function matchGlob(path: string, pattern: string): boolean {
  // Direct match
  if (pattern === path) return true;
  if (pattern === '*') return true;

  // Convert glob to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape special regex chars
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___GLOBSTAR___/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${regexStr}$`).test(path);
}

export function matchAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((p) => matchGlob(path, p));
}

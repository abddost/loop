/**
 * Glob-style wildcard pattern matching.
 * Adapted from opencode's wildcard matching system.
 *
 * Supports:
 *   * — matches any characters (including none)
 *   ? — matches exactly one character
 *   Trailing " *" (space-star) — makes trailing arguments optional
 *     e.g., "ls *" matches both "ls" and "ls -la"
 */
export namespace Wildcard {
	/**
	 * Test whether `str` matches the glob `pattern`.
	 *
	 * @param str - The string to test
	 * @param pattern - Glob pattern with * and ? wildcards
	 * @returns true if `str` matches `pattern`
	 */
	export function match(str: string, pattern: string): boolean {
		let escaped = pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars
			.replace(/\*/g, ".*") // * → .*
			.replace(/\?/g, ".") // ? → .

		// If pattern ends with " .*" (from " *"), make the trailing part optional.
		// This allows "ls *" to match both "ls" and "ls -la".
		if (escaped.endsWith(" .*")) {
			escaped = `${escaped.slice(0, -3)}( .*)?`
		}

		return new RegExp(`^${escaped}$`, "s").test(str)
	}
}

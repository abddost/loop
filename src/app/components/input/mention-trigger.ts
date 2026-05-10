/**
 * Detect whether the textarea cursor is currently inside an active `@`
 * mention context.
 *
 * Rules (mirroring GitHub / Linear / Notion conventions):
 * - Walk back from the cursor until we hit `@` (active mention) or
 *   whitespace (no mention) or the start of input.
 * - The `@` must be at position 0 OR preceded by whitespace, otherwise
 *   it's part of a word (`email@example.com`) — not a trigger.
 * - The query is everything between `@` (exclusive) and cursor.
 * - Whitespace inside the candidate query closes the menu (so the user
 *   can type `Compare @cart.ts and @page.tsx`, with each mention
 *   resolving independently).
 *
 * Returns null when no active mention.
 */
export interface MentionContext {
	/** Index of the `@` character (inclusive). */
	start: number
	/** Index right after the last query character (== cursor position). */
	end: number
	/** Text the user has typed after the `@`, possibly empty. */
	query: string
}

export function findMentionContext(text: string, cursor: number): MentionContext | null {
	if (cursor < 0 || cursor > text.length) return null

	for (let i = cursor - 1; i >= 0; i--) {
		const ch = text.charCodeAt(i)
		// Whitespace between cursor and any `@` invalidates the mention.
		if (isWhitespace(ch)) return null

		// `@`
		if (ch === 64) {
			// Must be at start of input or preceded by whitespace.
			if (i === 0 || isWhitespace(text.charCodeAt(i - 1))) {
				return {
					start: i,
					end: cursor,
					query: text.slice(i + 1, cursor),
				}
			}
			return null
		}
	}
	return null
}

function isWhitespace(code: number): boolean {
	// space, tab, newline, carriage return, form feed, vertical tab
	return code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12
}

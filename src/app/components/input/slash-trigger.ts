/**
 * Detect whether the textarea cursor is currently inside an active `/`
 * slash-command context.
 *
 * Rules (mirroring t3code's `composer-logic.ts:detectComposerTrigger`):
 * - The `/` MUST be at the start of a line — start of input or
 *   immediately after a newline. `https://example.com/foo` mid-text
 *   would otherwise spam the menu.
 * - Walk forward from `/` to the cursor; abort if any whitespace appears
 *   in the candidate query. Once the user types `/compact ` (with a
 *   trailing space) the menu closes so the rest of the line is freeform
 *   command arguments.
 * - The query is everything between `/` (exclusive) and cursor.
 *
 * Returns null when no active slash command context.
 */
export interface SlashCommandContext {
	/** Index of the `/` character (inclusive). */
	start: number
	/** Index right after the last query character (== cursor position). */
	end: number
	/** Text the user has typed after the `/`, possibly empty. */
	query: string
}

export function findSlashCommandContext(
	text: string,
	cursor: number,
): SlashCommandContext | null {
	if (cursor < 0 || cursor > text.length) return null

	// Find the start of the current line. The `/` only counts at the
	// start of a line (matches Claude Code's CLI palette behaviour).
	const lineStart = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1
	if (text.charCodeAt(lineStart) !== 47 /* '/' */) return null

	// Reject if any whitespace appears between the `/` and the cursor.
	// This makes `/compact   ` close the menu so the user can keep
	// typing freeform args.
	for (let i = lineStart + 1; i < cursor; i++) {
		if (isWhitespace(text.charCodeAt(i))) return null
	}

	return {
		start: lineStart,
		end: cursor,
		query: text.slice(lineStart + 1, cursor),
	}
}

function isWhitespace(code: number): boolean {
	// space, tab, newline, carriage return, form feed, vertical tab
	return code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12
}

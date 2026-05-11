/**
 * Handler for a loop2-intercepted slash command.
 *
 * IMPORTANT: actions run on **submit**, never on selection. Picking a
 * command from the `/` menu (mouse, Tab, or arrow+Enter) only inserts
 * `/<name>` into the textarea — exactly like the Claude Code CLI. The
 * action fires when the user then submits the line. This keeps the
 * "choose a command" gesture non-destructive: nothing happens until the
 * user explicitly commits.
 *
 * `args` is everything after the command word, trimmed. E.g. submitting
 * `/usage 30d` calls the `usage` action with `args === "30d"`.
 */
export type SlashCommandAction = (args: string) => void | Promise<void>

/**
 * Map keyed by command name (without leading slash) → handler.
 * Passed into the input bar as a prop so the action's closure can carry
 * navigation / api / store access from the host page.
 *
 * On submit, the input bar checks `text.trim()`: if it starts with `/`
 * and the first word is a key here, the action runs and the line is NOT
 * sent to the SDK. Everything else — regular prose, `/help`, `/compact`,
 * plugin commands — flows to the SDK unchanged so it can process its own
 * slash commands natively.
 */
export type SlashCommandActions = Record<string, SlashCommandAction>

/**
 * Parse a submitted line into a slash-command name + args, or null when
 * it isn't a slash command. The name is the first whitespace-delimited
 * token after `/`; args is the remainder, trimmed.
 *
 *   "/usage"          → { name: "usage", args: "" }
 *   "/usage 30d"      → { name: "usage", args: "30d" }
 *   "/compact do x"   → { name: "compact", args: "do x" }
 *   "hello /usage"    → null   (slash must be at the very start)
 *   "/"               → null   (no command name)
 */
export function parseSlashCommandLine(text: string): { name: string; args: string } | null {
	const trimmed = text.trim()
	if (!trimmed.startsWith("/") || trimmed.length < 2) return null
	const body = trimmed.slice(1)
	const spaceIdx = body.search(/\s/)
	if (spaceIdx === -1) return { name: body, args: "" }
	return { name: body.slice(0, spaceIdx), args: body.slice(spaceIdx + 1).trim() }
}

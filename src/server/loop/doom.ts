import { Workspace } from "../workspace"

/** Recent tool calls per session for doom loop detection. */
export const recentToolCalls = Workspace.state(
	() => new Map<string, Array<{ tool: string; input: string }>>(),
)

/**
 * Record a tool call and check for doom loop.
 * A doom loop is detected when the same tool is called 3 times
 * with identical arguments in succession.
 *
 * @param sessionId - The session to check
 * @param tool - The tool name
 * @param input - The tool input (will be JSON-serialized for comparison)
 * @returns true if doom loop detected
 */
export function recordAndCheckDoom(sessionId: string, tool: string, input: unknown): boolean {
	const calls = recentToolCalls()
	if (!calls.has(sessionId)) calls.set(sessionId, [])

	const history = calls.get(sessionId)!
	const serialized = JSON.stringify(input)
	history.push({ tool, input: serialized })

	// Keep only last 10 calls
	if (history.length > 10) history.splice(0, history.length - 10)

	// Check last 3 calls
	if (history.length < 3) return false
	const last3 = history.slice(-3)
	const first = last3[0]
	return last3.every((c) => c.tool === first.tool && c.input === first.input)
}

/** Clear doom history for a session (after user intervention). */
export function clearDoomHistory(sessionId: string): void {
	recentToolCalls().delete(sessionId)
}

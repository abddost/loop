/**
 * macOS PATH fix.
 *
 * GUI apps launched from the Dock inherit a minimal PATH that excludes
 * Homebrew, nvm, and other user-installed binaries. This reads the full
 * PATH from the user's login shell so we can find `bun`.
 *
 * Must be called synchronously at the top of main.ts before any child
 * process spawning. Silently falls back to the inherited PATH on failure.
 */

import { execFileSync } from "node:child_process"

const PATH_START = "__LOOP_PATH_START__"
const PATH_END = "__LOOP_PATH_END__"

export function fixPath(): void {
	if (process.platform !== "darwin") return

	const shell = process.env.SHELL || "/bin/zsh"
	try {
		const output = execFileSync(
			shell,
			["-ilc", `echo ${PATH_START}\${PATH}${PATH_END}`],
			{
				encoding: "utf-8",
				timeout: 5_000,
				stdio: ["ignore", "pipe", "ignore"],
			},
		)

		const startIdx = output.indexOf(PATH_START)
		const endIdx = output.indexOf(PATH_END)
		if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return

		const extractedPath = output.slice(startIdx + PATH_START.length, endIdx).trim()
		if (extractedPath) {
			process.env.PATH = extractedPath
		}
	} catch {
		// Silent fallback — keep inherited PATH
	}
}

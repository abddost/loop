import { type ChildProcess, spawn } from "node:child_process"
import * as fs from "node:fs"

const SIGKILL_DELAY_MS = 200

const SHELL_BLACKLIST = new Set(["fish", "nu", "nushell", "elvish", "xonsh"])

/**
 * Pick the shell binary to spawn child processes through. Prefers the user's
 * $SHELL when it isn't a non-POSIX-ish shell (fish/nu/etc), otherwise falls
 * back to /bin/zsh on darwin and /bin/bash on Linux. On Windows we look for
 * Git Bash and fall back to cmd.exe.
 */
export function getShell(): string {
	if (process.platform === "win32") {
		const gitBash = findGitBash()
		if (gitBash) return gitBash
		return process.env.COMSPEC || "cmd.exe"
	}

	const userShell = process.env.SHELL
	if (userShell) {
		const shellName = userShell.split("/").pop() ?? ""
		if (!SHELL_BLACKLIST.has(shellName)) return userShell
	}

	if (process.platform === "darwin") return "/bin/zsh"
	return "/bin/bash"
}

function findGitBash(): string | undefined {
	try {
		const programFiles = process.env.ProgramFiles || "C:\\Program Files"
		const candidates = [
			`${programFiles}\\Git\\bin\\bash.exe`,
			`${process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"}\\Git\\bin\\bash.exe`,
			"C:\\Git\\bin\\bash.exe",
		]
		for (const candidate of candidates) {
			try {
				if (fs.existsSync(candidate)) return candidate
			} catch {}
		}
	} catch {}
	return undefined
}

/**
 * Build the environment passed to spawned shells. Strips colors and forces
 * a dumb TERM so output parsing is deterministic, and sets CHCP on Windows
 * for Unicode passthrough.
 */
export function buildShellEnv(): Record<string, string | undefined> {
	return {
		...process.env,
		TERM: "dumb",
		NO_COLOR: "1",
		FORCE_COLOR: "0",
		...(process.platform === "win32" ? { CHCP: "65001" } : {}),
	}
}

/**
 * Terminate a process tree. SIGTERM first, then SIGKILL after a short grace
 * period if the process is still alive. On Windows, taskkill /t /f recurses
 * into child processes; on POSIX, signaling the negative pid hits the whole
 * group when `detached: true` was used at spawn.
 *
 * `exited()` is checked twice: once to short-circuit if the caller already
 * observed exit, and again before the SIGKILL so a graceful exit during the
 * grace window doesn't get a redundant force-kill.
 */
export async function killTree(proc: ChildProcess, opts: { exited: () => boolean }): Promise<void> {
	if (opts.exited()) return
	try {
		if (process.platform === "win32") {
			spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" })
		} else if (proc.pid) {
			try {
				process.kill(-proc.pid, "SIGTERM")
			} catch {
				proc.kill("SIGTERM")
			}
			await new Promise((r) => setTimeout(r, SIGKILL_DELAY_MS))
			if (!opts.exited()) {
				try {
					process.kill(-proc.pid, "SIGKILL")
				} catch {
					proc.kill("SIGKILL")
				}
			}
		}
	} catch {
		/* already dead */
	}
}

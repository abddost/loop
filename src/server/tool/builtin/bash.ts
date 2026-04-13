import { type ChildProcess, spawn } from "node:child_process"
import * as fs from "node:fs"
import { z } from "zod"
import { splitBashCommand } from "../../lib/shell-split"
import { BashArity } from "../../permission/arity"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = 2 * 60 * 1000
const SIGKILL_DELAY_MS = 200

// ── Shell Selection ──────────────────────────────────────────────────────────

const SHELL_BLACKLIST = new Set(["fish", "nu", "nushell", "elvish", "xonsh"])

function getShell(): string {
	if (process.platform === "win32") {
		// Try Git Bash first, fall back to cmd.exe
		const gitBash = findGitBash()
		if (gitBash) return gitBash
		return process.env.COMSPEC || "cmd.exe"
	}

	// Prefer user's shell, but skip blacklisted shells
	const userShell = process.env.SHELL
	if (userShell) {
		const shellName = userShell.split("/").pop() ?? ""
		if (!SHELL_BLACKLIST.has(shellName)) return userShell
	}

	// OS-specific fallbacks
	if (process.platform === "darwin") return "/bin/zsh"
	// Linux: prefer bash, fall back to sh
	return "/bin/bash"
}

function findGitBash(): string | undefined {
	try {
		const programFiles = process.env.ProgramFiles || "C:\\Program Files"
		const gitBashPath = `${programFiles}\\Git\\bin\\bash.exe`
		// Check common locations
		const candidates = [
			gitBashPath,
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

// ── Process Tree Killing ─────────────────────────────────────────────────────

async function killTree(proc: ChildProcess, opts: { exited: () => boolean }): Promise<void> {
	if (opts.exited()) return
	try {
		if (process.platform === "win32") {
			spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" })
		} else if (proc.pid) {
			// Graceful: SIGTERM first
			try {
				process.kill(-proc.pid, "SIGTERM")
			} catch {
				proc.kill("SIGTERM")
			}
			// Wait, then force-kill if still alive
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

// ── Bash Tool ────────────────────────────────────────────────────────────────

/** Execute bash commands in the workspace directory. */
export const bashTool: Tool.Shape = {
	id: "bash",
	init() {
		return {
			description:
				"Execute a bash command in the workspace directory. Use for running tests, installing packages, git operations, and other shell commands.",
			parameters: z.object({
				command: z.string().describe("The bash command to execute"),
				timeout: z
					.number()
					.positive()
					.optional()
					.describe(`Timeout in milliseconds (default: ${DEFAULT_TIMEOUT})`),
				description: z.string().describe("5-10 word description of what the command does"),
			}),
			async execute(ctx, input) {
				// Decompose the command so the permission layer evaluates each
				// sub-command independently. A rule like `allow: git pull` must
				// not silently authorize `git pull && rm -rf /` — each segment
				// and sub-shell body has to clear the ruleset on its own.
				const split = splitBashCommand(input.command)
				const patterns = Array.from(
					new Set([input.command, ...split.segments, ...split.subshells].filter(Boolean)),
				)

				// Derive "always allow" patterns from the prefix of each segment.
				// Naive whitespace split is fine here — segments come from the
				// shell-aware splitter, so quoted boundaries are already respected
				// at the command level. We still want the primary token.
				const alwaysPatterns = new Set<string>()
				const sources = split.segments.length > 0 ? split.segments : [input.command]
				for (const cmd of sources) {
					const tokens = cmd.trim().split(/\s+/)
					const prefixTokens = BashArity.prefix(tokens)
					if (prefixTokens.length > 0) alwaysPatterns.add(`${prefixTokens.join(" ")} *`)
				}
				if (alwaysPatterns.size === 0) alwaysPatterns.add("*")

				await ctx.ask({
					permission: "bash",
					patterns,
					always: [...alwaysPatterns],
					metadata: { reason: `Run command: ${input.command}` },
				})

				const cwd = Workspace.dir()
				const shell = getShell()
				const timeout = input.timeout ?? DEFAULT_TIMEOUT

				let didExit = false
				let output = ""
				let exitCode: number | null = null
				let timedOut = false
				let aborted = false

				return new Promise<{ output: string; metadata: Record<string, unknown> }>((resolve) => {
					const env: Record<string, string | undefined> = {
						...process.env,
						TERM: "dumb",
						// Disable colors/formatting that may interfere with output parsing
						NO_COLOR: "1",
						FORCE_COLOR: "0",
						// Set consistent locale for Windows Unicode support
						...(process.platform === "win32" ? { CHCP: "65001" } : {}),
					}

					const proc = spawn(input.command, {
						cwd,
						shell,
						stdio: ["ignore", "pipe", "pipe"],
						env,
						detached: process.platform !== "win32",
					})

					// ── Streaming output ─────────────────────────────────

					function append(chunk: string) {
						output += chunk
						const truncated =
							output.length > MAX_METADATA_LENGTH
								? `...truncated\n${output.slice(-MAX_METADATA_LENGTH)}`
								: output
						ctx.metadata({
							metadata: {
								output: truncated,
								description: input.description,
							},
						})
					}

					proc.stdout?.on("data", (data: Buffer) => {
						append(data.toString("utf-8"))
					})

					proc.stderr?.on("data", (data: Buffer) => {
						append(data.toString("utf-8"))
					})

					// ── Timeout ──────────────────────────────────────────

					const timer = setTimeout(() => {
						timedOut = true
						void killTree(proc, { exited: () => didExit })
					}, timeout + 100)

					// ── Abort handling ────────────────────────────────────

					function onAbort() {
						aborted = true
						void killTree(proc, { exited: () => didExit })
					}

					if (ctx.signal.aborted) {
						aborted = true
						void killTree(proc, { exited: () => didExit })
					} else {
						ctx.signal.addEventListener("abort", onAbort, { once: true })
					}

					// ── Process exit ─────────────────────────────────────

					proc.on("exit", (code) => {
						didExit = true
						exitCode = code
						clearTimeout(timer)
						ctx.signal.removeEventListener("abort", onAbort)
						finish()
					})

					proc.on("error", (err) => {
						didExit = true
						clearTimeout(timer)
						ctx.signal.removeEventListener("abort", onAbort)
						output += `\nProcess error: ${err.message}`
						finish()
					})

					function finish() {
						let result = output

						if (timedOut || aborted) {
							const reason = timedOut ? "timed_out" : "aborted"
							result += `\n<bash_metadata>\nstatus: ${reason}\n</bash_metadata>`
						}

						if (exitCode !== null && exitCode !== 0) {
							result += `\nExit code: ${exitCode}`
						}

						const truncatedOutput =
							output.length > MAX_METADATA_LENGTH
								? `...truncated\n${output.slice(-MAX_METADATA_LENGTH)}`
								: output

						resolve({
							output: result,
							metadata: {
								output: truncatedOutput,
								exitCode,
								description: input.description,
							},
						})
					}
				})
			},
		}
	},
}

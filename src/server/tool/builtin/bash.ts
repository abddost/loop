import { type ChildProcess, spawn } from "node:child_process"
import { z } from "zod"
import { BashArity } from "../../permission/arity"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = 2 * 60 * 1000

// ── Shell Selection ──────────────────────────────────────────────────────────

function getShell(): string {
	if (process.platform === "win32") return "cmd.exe"
	return process.env.SHELL || "/bin/bash"
}

// ── Process Tree Killing ─────────────────────────────────────────────────────

function killTree(proc: ChildProcess, opts: { exited: () => boolean }): void {
	if (opts.exited()) return
	try {
		if (process.platform === "win32") {
			spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"])
		} else if (proc.pid) {
			process.kill(-proc.pid, "SIGTERM")
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
				// Parse command into tokens for arity-based "always allow" patterns
				const tokens = input.command.trim().split(/\s+/)
				const prefixTokens = BashArity.prefix(tokens)
				const alwaysPattern = prefixTokens.length > 0 ? `${prefixTokens.join(" ")} *` : "*"

				// Request permission with the full command as pattern
				await ctx.ask({
					permission: "bash",
					patterns: [input.command],
					always: [alwaysPattern],
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
					const proc = spawn(input.command, {
						cwd,
						shell,
						stdio: ["ignore", "pipe", "pipe"],
						env: { ...process.env, TERM: "dumb" },
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
						killTree(proc, { exited: () => didExit })
					}, timeout + 100)

					// ── Abort handling ────────────────────────────────────

					function onAbort() {
						aborted = true
						killTree(proc, { exited: () => didExit })
					}

					if (ctx.signal.aborted) {
						aborted = true
						killTree(proc, { exited: () => didExit })
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

import { spawn } from "node:child_process"
import { z } from "zod"
import { buildShellEnv, getShell, killTree } from "../../lib/shell"
import { splitBashCommand } from "../../lib/shell-split"
import { BashArity } from "../../permission/arity"
import { processManager } from "../../process/manager"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = 2 * 60 * 1000

/** Execute bash commands in the workspace directory. */
export const bashTool: Tool.Shape = {
	id: "bash",
	init() {
		return {
			description:
				"Execute a bash command in the workspace directory. Use for running tests, installing packages, git operations, and other shell commands. " +
				"For long-running commands like dev servers, file watchers, or test suites that may exceed the 2-minute timeout, set background:true — " +
				"the command runs detached and returns a process id immediately. Use bash_output to poll its output and bash_kill to terminate it.",
			parameters: z.object({
				command: z.string().describe("The bash command to execute"),
				timeout: z
					.number()
					.positive()
					.optional()
					.describe(
						`Timeout in milliseconds (default: ${DEFAULT_TIMEOUT}). Ignored when background:true.`,
					),
				description: z.string().describe("5-10 word description of what the command does"),
				background: z
					.boolean()
					.optional()
					.describe(
						"Run the command in the background. Returns immediately with a process id; use bash_output to read output and bash_kill to terminate. Use for dev servers, watchers, or commands expected to run longer than the foreground timeout.",
					),
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

				if (input.background) {
					const result = await processManager().spawn({
						command: input.command,
						description: input.description,
					})
					const lines = [
						"Background process started.",
						`id: ${result.id}`,
						`pid: ${result.pid ?? "unknown"}`,
						`status: ${result.status}`,
					]
					if (result.exitCode !== null) lines.push(`exitCode: ${result.exitCode}`)
					if (result.output) lines.push("", "Initial output:", result.output)
					lines.push(
						"",
						"Use bash_output with this id to read further output. Use bash_kill to terminate.",
					)
					ctx.metadata({
						metadata: {
							processId: result.id,
							pid: result.pid,
							status: result.status,
							background: true,
							output: result.output,
							description: input.description,
						},
					})
					return {
						output: lines.join("\n"),
						metadata: {
							processId: result.id,
							pid: result.pid,
							status: result.status,
							exitCode: result.exitCode,
							background: true,
							description: input.description,
						},
					}
				}

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
						env: buildShellEnv(),
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

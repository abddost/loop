import { z } from "zod"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

/** Execute bash commands in the workspace directory. */
export const bashTool: Tool.Shape = {
	id: "bash",
	init() {
		return {
			description:
				"Execute a bash command in the workspace directory. Use for running tests, installing packages, git operations, and other shell commands.",
			parameters: z.object({
				command: z.string().describe("The bash command to execute"),
				timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
			}),
			async execute(ctx, input) {
				const allowed = await ctx.ask({
					reason: `Run command: ${input.command}`,
				})
				if (!allowed) return { output: "Permission denied by user." }

				const cwd = Workspace.dir()
				const timeout = input.timeout ?? 30_000

				const proc = Bun.spawn(["bash", "-c", input.command], {
					cwd,
					stdout: "pipe",
					stderr: "pipe",
					env: { ...process.env, TERM: "dumb" },
				})

				// Race execution against timeout and abort signal
				const timer = setTimeout(() => proc.kill(), timeout)
				const onAbort = () => proc.kill()
				ctx.signal.addEventListener("abort", onAbort, { once: true })

				const decoder = new TextDecoder()
				let output = ""

				// Stream stdout chunks via metadata
				const reader = proc.stdout.getReader()
				try {
					while (true) {
						const { done, value } = await reader.read()
						if (done) break
						const chunk = decoder.decode(value)
						output += chunk
						ctx.metadata({ metadata: { stdout: chunk } })
					}
				} catch {
					/* stream ended */
				}

				const stderr = await new Response(proc.stderr).text()
				const exitCode = await proc.exited

				clearTimeout(timer)
				ctx.signal.removeEventListener("abort", onAbort)

				if (stderr) output += `\nSTDERR:\n${stderr}`
				if (exitCode !== 0) output += `\nExit code: ${exitCode}`

				return { output, metadata: { exitCode } }
			},
		}
	},
}

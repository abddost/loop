import { type ChildProcess, spawn } from "node:child_process"
import { createServer } from "node:net"
import { type OpencodeClient, createOpencodeClient } from "@opencode-ai/sdk/v2"
import { createLogger } from "../../logger"

const log = createLogger("opencode:client")

/**
 * Where the OpenCode SDK client is connected — either an externally-managed
 * server (no lifecycle owned here) or a freshly-spawned local CLI process
 * whose lifetime the caller must release via `dispose()`.
 */
export interface OpenCodeConnection {
	readonly url: string
	readonly client: OpencodeClient
	/** True when the server is managed externally (don't kill the process). */
	readonly external: boolean
	/** Stop the spawned child process. No-op for external servers. */
	dispose(): Promise<void>
}

interface ConnectInput {
	binaryPath: string
	directory: string
	serverUrl?: string
	serverPassword?: string
	timeoutMs?: number
}

/**
 * Connect to OpenCode — spawn a local server when no `serverUrl` is provided,
 * otherwise attach to the externally-managed one.
 *
 * For local mode we run `opencode serve --hostname=127.0.0.1 --port=N` and
 * scrape stdout for the "opencode server listening on …" announcement to
 * recover the actual URL (port may differ from what we asked for).
 *
 * The returned client uses HTTP Basic auth when a `serverPassword` is set —
 * this matches OpenCode's `--password` flag and t3code's wire format.
 */
export async function connectOpenCode(input: ConnectInput): Promise<OpenCodeConnection> {
	const trimmedUrl = input.serverUrl?.trim() ?? ""
	if (trimmedUrl.length > 0) {
		const client = buildClient(trimmedUrl, input.directory, input.serverPassword)
		return {
			url: trimmedUrl,
			client,
			external: true,
			dispose: async () => {
				/* externally-managed — nothing to clean up */
			},
		}
	}

	const spawned = await spawnLocalServer({
		binaryPath: input.binaryPath,
		timeoutMs: input.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
	})
	const client = buildClient(spawned.url, input.directory)
	return {
		url: spawned.url,
		client,
		external: false,
		dispose: spawned.dispose,
	}
}

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000
const SERVER_READY_PREFIX = "opencode server listening"

function buildClient(baseUrl: string, directory: string, password?: string): OpencodeClient {
	return createOpencodeClient({
		baseUrl,
		directory,
		...(password
			? {
					headers: {
						Authorization: `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`,
					},
				}
			: {}),
		throwOnError: true,
	})
}

interface SpawnedServer {
	url: string
	dispose: () => Promise<void>
}

async function spawnLocalServer(opts: {
	binaryPath: string
	timeoutMs: number
}): Promise<SpawnedServer> {
	const port = await findAvailablePort()
	const args = ["serve", "--hostname=127.0.0.1", `--port=${port}`]
	const child = spawn(opts.binaryPath, args, {
		// `detached` lets us kill the whole process group on shutdown so
		// straggler `serve` children don't outlive the main process.
		detached: process.platform !== "win32",
		shell: process.platform === "win32",
		env: { ...process.env, OPENCODE_CONFIG_CONTENT: "{}" },
	})

	const url = await waitForReady(child, opts.timeoutMs)
	log.info("OpenCode local server started", { url, port, binaryPath: opts.binaryPath })

	return {
		url,
		dispose: () => stopChild(child),
	}
}

async function findAvailablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer()
		srv.unref()
		srv.on("error", reject)
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address()
			if (addr && typeof addr === "object") {
				const port = addr.port
				srv.close(() => resolve(port))
			} else {
				srv.close(() => reject(new Error("Failed to allocate port")))
			}
		})
	})
}

function waitForReady(child: ChildProcess, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		let stdout = ""
		let stderr = ""
		let settled = false

		const cleanup = () => {
			child.stdout?.off("data", onStdout)
			child.stderr?.off("data", onStderr)
			child.off("exit", onExit)
			child.off("error", onError)
			clearTimeout(timer)
		}

		const onStdout = (chunk: Buffer) => {
			stdout += chunk.toString("utf8")
			const url = parseReadyUrl(stdout)
			if (url && !settled) {
				settled = true
				cleanup()
				resolve(url)
			}
		}
		const onStderr = (chunk: Buffer) => {
			stderr += chunk.toString("utf8")
		}
		const onExit = (code: number | null) => {
			if (settled) return
			settled = true
			cleanup()
			const detail = [
				`OpenCode server exited before startup (code ${code ?? "?"}).`,
				stdout.trim() ? `stdout:\n${stdout.trim()}` : null,
				stderr.trim() ? `stderr:\n${stderr.trim()}` : null,
			]
				.filter(Boolean)
				.join("\n\n")
			reject(new Error(detail))
		}
		const onError = (err: Error) => {
			if (settled) return
			settled = true
			cleanup()
			reject(err)
		}

		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			cleanup()
			reject(new Error(`Timed out waiting for OpenCode server start after ${timeoutMs}ms`))
			void stopChild(child)
		}, timeoutMs)

		child.stdout?.on("data", onStdout)
		child.stderr?.on("data", onStderr)
		child.on("exit", onExit)
		child.on("error", onError)
	})
}

function parseReadyUrl(output: string): string | null {
	for (const line of output.split("\n")) {
		if (!line.trimStart().startsWith(SERVER_READY_PREFIX)) continue
		const match = line.match(/(https?:\/\/[^\s]+)/)
		if (match) return match[1] ?? null
	}
	return null
}

async function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return
	try {
		if (process.platform === "win32" || !child.pid) {
			child.kill("SIGTERM")
		} else {
			// Negative PID kills the whole process group (because we spawned
			// with `detached: true`), catching any grandchildren the CLI
			// forked.
			try {
				process.kill(-child.pid, "SIGTERM")
			} catch {
				child.kill("SIGTERM")
			}
		}
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				try {
					if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL")
					else child.kill("SIGKILL")
				} catch {
					/* ignore */
				}
				resolve()
			}, 1500)
			child.once("exit", () => {
				clearTimeout(timer)
				resolve()
			})
		})
	} catch (err) {
		log.warn("Failed to stop OpenCode child", { error: (err as Error).message })
	}
}

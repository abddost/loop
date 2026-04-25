/**
 * Bun sidecar child process lifecycle.
 *
 * Spawns the Bun server as a child process, captures its output,
 * and handles crash recovery with exponential backoff. The server
 * is configured entirely through environment variables.
 */

import { type ChildProcess, spawn } from "node:child_process"
import * as path from "node:path"
import { app } from "electron"
import { RotatingFileSink, writeSessionBoundary } from "./logging"
import type { SidecarConfig } from "./types"

let child: ChildProcess | null = null
let restartAttempt = 0
let restartTimer: ReturnType<typeof setTimeout> | null = null
let isQuitting = false
let currentConfig: SidecarConfig | null = null

// ── Public API ──────────────────────────────────────────────────────────────

export function startSidecar(config: SidecarConfig): void {
	currentConfig = config
	doSpawn(config)
}

export function stopSidecar(): void {
	isQuitting = true
	clearRestartTimer()

	if (!child) return
	try {
		child.kill("SIGTERM")
	} catch {
		// Already dead
	}

	// Force-kill after 2s if still alive
	const pid = child.pid
	setTimeout(() => {
		if (child && child.pid === pid && !child.killed) {
			try {
				child.kill("SIGKILL")
			} catch {
				// Already dead
			}
		}
	}, 2_000)
}

export async function stopSidecarAndWait(timeoutMs = 5_000): Promise<void> {
	isQuitting = true
	clearRestartTimer()

	if (!child) return

	return new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			if (child && !child.killed) {
				try {
					child.kill("SIGKILL")
				} catch {
					// Already dead
				}
			}
			resolve()
		}, timeoutMs)

		child!.once("exit", () => {
			clearTimeout(timer)
			resolve()
		})

		try {
			child!.kill("SIGTERM")
		} catch {
			clearTimeout(timer)
			resolve()
		}
	})
}

export function markQuitting(): void {
	isQuitting = true
	clearRestartTimer()
}

// ── Internal ────────────────────────────────────────────────────────────────

function resolveBunPath(): string {
	if (!app.isPackaged) {
		// Dev: use system bun from PATH
		return "bun"
	}
	// Production: bundled binary in resources
	const name = process.platform === "win32" ? "bun.exe" : "bun"
	return path.join(process.resourcesPath, "bun", name)
}

function resolveServerEntry(): string {
	if (!app.isPackaged) {
		return "src/server/index.ts"
	}
	// In packaged builds, server source is bundled via electron-builder `files`
	return path.join(app.getAppPath(), "src", "server", "index.ts")
}

function resolveServerCwd(): string {
	if (!app.isPackaged) {
		return path.resolve(__dirname, "..")
	}
	return app.getAppPath()
}

function doSpawn(config: SidecarConfig): void {
	if (isQuitting) return

	const bunPath = resolveBunPath()
	const serverEntry = resolveServerEntry()
	const cwd = resolveServerCwd()

	const args = config.isDev ? ["run", "--hot", serverEntry] : [serverEntry]

	const env: NodeJS.ProcessEnv = {
		...process.env,
		LOOP_PORT: String(config.port),
		LOOP_HOST: "127.0.0.1",
		LOOP_AUTH_TOKEN: config.authToken,
		NODE_ENV: config.isDev ? "development" : "production",
	}

	console.log(
		`[sidecar] Spawning: ${bunPath} ${args.join(" ")} (port=${config.port}, cwd=${cwd})`,
	)

	const proc = spawn(bunPath, args, {
		cwd,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	})

	child = proc

	// ── Spawn ──
	proc.on("spawn", () => {
		restartAttempt = 0
		console.log(`[sidecar] Started (pid=${proc.pid})`)

		if (config.sidecarLogSink) {
			writeSessionBoundary(
				config.sidecarLogSink as RotatingFileSink,
				"START",
				{ pid: proc.pid, port: config.port, cwd },
			)
		}
	})

	// ── Stdout/Stderr capture ──
	if (config.sidecarLogSink) {
		proc.stdout?.on("data", (chunk: Buffer) => {
			config.sidecarLogSink!.write(chunk.toString("utf-8"))
		})
		proc.stderr?.on("data", (chunk: Buffer) => {
			config.sidecarLogSink!.write(chunk.toString("utf-8"))
		})
	} else {
		// Dev: pipe to main process console
		proc.stdout?.on("data", (chunk: Buffer) => {
			process.stdout.write(chunk)
		})
		proc.stderr?.on("data", (chunk: Buffer) => {
			process.stderr.write(chunk)
		})
	}

	// ── Error ──
	proc.on("error", (err) => {
		console.error(`[sidecar] Spawn error: ${err.message}`)
		child = null
		scheduleRestart(`spawn error: ${err.message}`)
	})

	// ── Exit ──
	proc.on("exit", (code, signal) => {
		console.log(
			`[sidecar] Exited (code=${code}, signal=${signal})`,
		)

		if (config.sidecarLogSink) {
			writeSessionBoundary(
				config.sidecarLogSink as RotatingFileSink,
				"END",
				{ pid: proc.pid, port: config.port, code, signal },
			)
		}

		child = null

		if (!isQuitting) {
			scheduleRestart(`exit code=${code} signal=${signal}`)
		}
	})
}

function scheduleRestart(reason: string): void {
	if (isQuitting || !currentConfig) return

	const delay = Math.min(500 * 2 ** restartAttempt, 10_000)
	restartAttempt++

	console.log(
		`[sidecar] Scheduling restart in ${delay}ms (attempt=${restartAttempt}, reason=${reason})`,
	)

	restartTimer = setTimeout(() => {
		restartTimer = null
		if (!isQuitting && currentConfig) {
			doSpawn(currentConfig)
		}
	}, delay)
}

function clearRestartTimer(): void {
	if (restartTimer) {
		clearTimeout(restartTimer)
		restartTimer = null
	}
}

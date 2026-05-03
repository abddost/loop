import { type ChildProcess, spawn } from "node:child_process"
import { nanoid } from "@core/id"
import { buildShellEnv, getShell, killTree } from "../lib/shell"
import { createLogger } from "../logger"
import { Workspace } from "../workspace"

const log = createLogger("process")

/**
 * Per-process ring buffer cap. Output past this is dropped from the head
 * (oldest bytes go first) so a runaway dev server can't blow up memory.
 * Per-call return is further truncated by the tool layer to ~50KB.
 */
const MAX_BUFFER_BYTES = 256 * 1024

/** Hard cap on bytes returned to the agent in a single read. Leaves
 * headroom under the tool-layer 50KB truncation for status metadata. */
const MAX_READ_BYTES = 48 * 1024

/** Window after spawn during which we wait for fast spawn failures or
 * immediate output before resolving the initial result. */
const SPAWN_GRACE_MS = 250

/** Cap on retained completed processes per workspace. Oldest evicted first. */
const MAX_COMPLETED_RETAINED = 50

export type BgStatus = "running" | "exited" | "killed" | "failed"

export interface BgProcessInfo {
	id: string
	pid: number | undefined
	command: string
	description: string
	status: BgStatus
	exitCode: number | null
	startedAt: number
	endedAt: number | undefined
	outputTruncated: boolean
}

export interface BgReadResult extends BgProcessInfo {
	output: string
}

interface BgProcess extends BgProcessInfo {
	proc: ChildProcess
	procExited: boolean
	chunks: string[]
	chunksBytes: number
}

export interface SpawnInput {
	command: string
	description: string
}

export interface SpawnResult extends BgProcessInfo {
	output: string
}

export class ProcessManagerImpl {
	private processes = new Map<string, BgProcess>()

	constructor(private readonly cwd: string) {}

	async spawn(input: SpawnInput): Promise<SpawnResult> {
		this.evictCompleted()
		const id = nanoid(12)
		const shell = getShell()

		const proc = spawn(input.command, {
			cwd: this.cwd,
			shell,
			stdio: ["ignore", "pipe", "pipe"],
			env: buildShellEnv(),
			detached: process.platform !== "win32",
		})

		const bg: BgProcess = {
			id,
			pid: proc.pid,
			command: input.command,
			description: input.description,
			status: "running",
			exitCode: null,
			startedAt: Date.now(),
			endedAt: undefined,
			outputTruncated: false,
			proc,
			procExited: false,
			chunks: [],
			chunksBytes: 0,
		}
		this.processes.set(id, bg)

		const append = (chunk: string) => {
			if (chunk.length === 0) return
			bg.chunks.push(chunk)
			bg.chunksBytes += chunk.length
			while (bg.chunksBytes > MAX_BUFFER_BYTES && bg.chunks.length > 1) {
				const removed = bg.chunks.shift()!
				bg.chunksBytes -= removed.length
				bg.outputTruncated = true
			}
			if (bg.chunksBytes > MAX_BUFFER_BYTES) {
				const overflow = bg.chunksBytes - MAX_BUFFER_BYTES
				bg.chunks[0] = bg.chunks[0].slice(overflow)
				bg.chunksBytes -= overflow
				bg.outputTruncated = true
			}
		}

		proc.stdout?.on("data", (data: Buffer) => append(data.toString("utf-8")))
		proc.stderr?.on("data", (data: Buffer) => append(data.toString("utf-8")))

		// Long-lived terminal-state handlers. Attached unconditionally so a
		// post-grace exit (or kill, or error) is always recorded.
		proc.once("exit", (code) => {
			bg.procExited = true
			if (bg.status === "killed") {
				if (bg.exitCode === null) bg.exitCode = code
				return
			}
			if (bg.status !== "running") return
			bg.status = code === 0 ? "exited" : "failed"
			bg.exitCode = code
			bg.endedAt = Date.now()
		})
		proc.once("error", (err) => {
			if (bg.status !== "running") return
			append(`\nProcess error: ${err.message}`)
			bg.status = "failed"
			bg.exitCode = bg.exitCode ?? -1
			bg.endedAt = Date.now()
		})

		// Wait briefly so a fast-failing command surfaces its exit code in the
		// initial result. The terminal-state handlers above always run first
		// (registration order), so by the time we resolve, bg.status reflects
		// the correct state.
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, SPAWN_GRACE_MS)
			const finish = () => {
				clearTimeout(timer)
				resolve()
			}
			proc.once("exit", finish)
			proc.once("error", finish)
		})

		log.info("Spawned background process", {
			id,
			pid: proc.pid,
			command: input.command,
			status: bg.status,
		})

		return this.snapshot(bg)
	}

	read(id: string): BgReadResult | undefined {
		const bg = this.processes.get(id)
		if (!bg) return undefined
		return this.snapshot(bg)
	}

	async kill(id: string): Promise<boolean> {
		const bg = this.processes.get(id)
		if (!bg) return false
		if (bg.status !== "running") return true

		bg.status = "killed"
		bg.endedAt = Date.now()
		await killTree(bg.proc, { exited: () => bg.procExited })
		log.info("Killed background process", { id, pid: bg.pid })
		return true
	}

	list(): BgProcessInfo[] {
		return [...this.processes.values()].map((bg) => this.toInfo(bg))
	}

	async dispose(): Promise<void> {
		const ids = [...this.processes.keys()]
		await Promise.allSettled(ids.map((id) => this.kill(id)))
		this.processes.clear()
		log.info("Process manager disposed")
	}

	private snapshot(bg: BgProcess): BgReadResult {
		const joined = bg.chunks.join("")
		const output = joined.length > MAX_READ_BYTES ? joined.slice(-MAX_READ_BYTES) : joined
		const truncated = bg.outputTruncated || joined.length > MAX_READ_BYTES
		return {
			...this.toInfo(bg),
			outputTruncated: truncated,
			output,
		}
	}

	private toInfo(bg: BgProcess): BgProcessInfo {
		return {
			id: bg.id,
			pid: bg.pid,
			command: bg.command,
			description: bg.description,
			status: bg.status,
			exitCode: bg.exitCode,
			startedAt: bg.startedAt,
			endedAt: bg.endedAt,
			outputTruncated: bg.outputTruncated,
		}
	}

	private evictCompleted(): void {
		const completed: BgProcess[] = []
		for (const bg of this.processes.values()) {
			if (bg.status !== "running") completed.push(bg)
		}
		if (completed.length <= MAX_COMPLETED_RETAINED) return
		completed.sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
		const toEvict = completed.slice(0, completed.length - MAX_COMPLETED_RETAINED)
		for (const bg of toEvict) this.processes.delete(bg.id)
	}
}

/**
 * Workspace-scoped background process registry. Auto-disposed (kills all
 * tracked processes) when the workspace closes, mirroring how
 * `terminalManager` handles user-facing PTY lifecycles.
 */
export const processManager = Workspace.state(
	() => new ProcessManagerImpl(Workspace.dir()),
	(mgr) => mgr.dispose(),
)

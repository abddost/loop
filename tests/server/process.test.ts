import { ProcessManagerImpl } from "@server/process/manager"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until<T>(
	predicate: () => T | undefined,
	{ timeout = 2000, step = 20 }: { timeout?: number; step?: number } = {},
): Promise<T> {
	const start = Date.now()
	while (Date.now() - start < timeout) {
		const value = predicate()
		if (value !== undefined && value !== false) return value as T
		await wait(step)
	}
	throw new Error("until: predicate never satisfied within timeout")
}

describe("ProcessManager", () => {
	let mgr: ProcessManagerImpl

	beforeEach(() => {
		mgr = new ProcessManagerImpl(process.cwd())
	})
	afterEach(async () => {
		await mgr.dispose()
	})

	it("captures exit code 0 and output for fast successful commands", async () => {
		const result = await mgr.spawn({ command: "echo hello-world", description: "echo" })
		expect(result.status).toBe("exited")
		expect(result.exitCode).toBe(0)
		expect(result.output).toContain("hello-world")
		expect(result.id).toBeTruthy()
		expect(result.pid).toBeTypeOf("number")
	})

	it("marks failure status when the command exits non-zero", async () => {
		const result = await mgr.spawn({ command: "sh -c 'exit 5'", description: "fail" })
		expect(result.status).toBe("failed")
		expect(result.exitCode).toBe(5)
	})

	it("returns running status for long-lived commands during the spawn grace window", async () => {
		const result = await mgr.spawn({ command: "sleep 3", description: "sleep" })
		expect(result.status).toBe("running")
		expect(result.exitCode).toBeNull()
		// Cleanup before sleep completes
		await mgr.kill(result.id)
	})

	it("read returns the latest snapshot for a known process", async () => {
		const spawned = await mgr.spawn({ command: "echo from-read", description: "echo" })
		const snap = mgr.read(spawned.id)
		expect(snap).toBeDefined()
		expect(snap?.status).toBe("exited")
		expect(snap?.output).toContain("from-read")
	})

	it("read returns undefined for unknown process ids", () => {
		expect(mgr.read("does-not-exist")).toBeUndefined()
	})

	it("kill terminates a running process and records the exit", async () => {
		const result = await mgr.spawn({ command: "sleep 30", description: "long sleep" })
		expect(result.status).toBe("running")

		const killed = await mgr.kill(result.id)
		expect(killed).toBe(true)

		const snap = await until(() => {
			const s = mgr.read(result.id)
			return s && s.status === "killed" ? s : undefined
		})
		expect(snap.status).toBe("killed")
		expect(snap.endedAt).toBeDefined()
	})

	it("kill on an already-completed process is a no-op success", async () => {
		const result = await mgr.spawn({ command: "echo done", description: "echo" })
		expect(result.status).toBe("exited")
		expect(await mgr.kill(result.id)).toBe(true)
	})

	it("kill on missing id returns false", async () => {
		expect(await mgr.kill("missing-id")).toBe(false)
	})

	it("dispose terminates all running processes", async () => {
		const a = await mgr.spawn({ command: "sleep 30", description: "a" })
		const b = await mgr.spawn({ command: "sleep 30", description: "b" })
		expect(a.status).toBe("running")
		expect(b.status).toBe("running")

		await mgr.dispose()
		expect(mgr.list()).toHaveLength(0)
	})

	it("ring buffer caps output and marks truncation when exceeded", async () => {
		// 300KB of output through the shell — exceeds the 256KB internal cap.
		// The 48KB read cap further trims the snapshot.
		const cmd = `node -e "process.stdout.write('a'.repeat(300000))"`
		const result = await mgr.spawn({ command: cmd, description: "big output" })

		// Wait a moment in case all data hadn't drained at resolve time.
		const final = await until(() => {
			const s = mgr.read(result.id)
			return s && s.status === "exited" ? s : undefined
		})

		expect(final.output.length).toBeLessThanOrEqual(48 * 1024)
		expect(final.outputTruncated).toBe(true)
	})

	it("list reflects spawned processes", async () => {
		const a = await mgr.spawn({ command: "echo one", description: "1" })
		const b = await mgr.spawn({ command: "echo two", description: "2" })
		const ids = mgr.list().map((p) => p.id)
		expect(ids).toContain(a.id)
		expect(ids).toContain(b.id)
	})
})

import { afterEach, describe, expect, it } from "vitest"
import {
	clearSession,
	getPendingTasks,
	hasPendingTasks,
	markTaskFinished,
	markTaskStarted,
} from "../../server/loop/claude-code/pending-tasks"

describe("claude-code pending-tasks registry", () => {
	afterEach(() => {
		clearSession("s1")
		clearSession("s2")
	})

	it("tracks pending tasks per session with their outputFile path", () => {
		expect(hasPendingTasks("s1")).toBe(false)
		markTaskStarted("s1", { taskId: "t1", outputFile: "/tmp/a.md", description: "A" })
		markTaskStarted("s1", { taskId: "t2", outputFile: "/tmp/b.md" })
		markTaskStarted("s2", { taskId: "t3", outputFile: "/tmp/c.md" })
		expect(hasPendingTasks("s1")).toBe(true)
		expect(getPendingTasks("s1").find((t) => t.taskId === "t1")).toMatchObject({
			outputFile: "/tmp/a.md",
			description: "A",
		})
		expect(getPendingTasks("s2")).toHaveLength(1)

		markTaskFinished("s1", "t1")
		expect(getPendingTasks("s1").map((t) => t.taskId)).toEqual(["t2"])

		markTaskFinished("s1", "t2")
		expect(hasPendingTasks("s1")).toBe(false)
	})

	it("merges outputFile if it backfills after the initial task_started", () => {
		markTaskStarted("s1", { taskId: "t1" })
		expect(getPendingTasks("s1")[0]?.outputFile).toBeUndefined()
		markTaskStarted("s1", { taskId: "t1", outputFile: "/tmp/a.md" })
		expect(getPendingTasks("s1")[0]?.outputFile).toBe("/tmp/a.md")
	})
})

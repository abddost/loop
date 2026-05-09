import { describe, expect, it } from "vitest"
import { buildOpenCodePlanReminder } from "../../server/agent/prompt/inject"
import {
	extractOpenCodeToolMetadata,
	loopToolToOpenCodeNames,
	mapOpenCodeToolName,
	transformOpenCodeToolInput,
} from "../../server/loop/opencode/tool-mapping"

describe("opencode tool-mapping", () => {
	describe("mapOpenCodeToolName", () => {
		it("preserves matching names as-is", () => {
			expect(mapOpenCodeToolName("read")).toBe("read")
			expect(mapOpenCodeToolName("write")).toBe("write")
			expect(mapOpenCodeToolName("edit")).toBe("edit")
			expect(mapOpenCodeToolName("bash")).toBe("bash")
		})

		it("normalizes case-variant and aliases", () => {
			expect(mapOpenCodeToolName("WebFetch")).toBe("web-fetch")
			expect(mapOpenCodeToolName("web_fetch")).toBe("web-fetch")
			expect(mapOpenCodeToolName("WEBFETCH")).toBe("web-fetch")
		})

		it("maps shell synonyms to bash", () => {
			expect(mapOpenCodeToolName("shell")).toBe("bash")
			expect(mapOpenCodeToolName("command")).toBe("bash")
		})

		it("normalizes plan tool spellings", () => {
			expect(mapOpenCodeToolName("plan_exit")).toBe("plan-exit")
			expect(mapOpenCodeToolName("plan_write")).toBe("plan-write")
			expect(mapOpenCodeToolName("plan-enter")).toBe("plan-enter")
		})

		it("falls through unknown tools", () => {
			expect(mapOpenCodeToolName("custom-mcp-tool")).toBe("custom-mcp-tool")
		})
	})

	describe("loopToolToOpenCodeNames", () => {
		it("returns OpenCode tool names for matching Loop ids", () => {
			expect(loopToolToOpenCodeNames("edit")).toEqual(["edit"])
			expect(loopToolToOpenCodeNames("write")).toEqual(["write"])
		})

		it("translates Loop's snake_case into OpenCode's kebab-case + alternates", () => {
			expect(loopToolToOpenCodeNames("apply_patch")).toEqual(["patch", "apply-patch"])
			expect(loopToolToOpenCodeNames("bash_output")).toEqual(["bash-output"])
			expect(loopToolToOpenCodeNames("bash_kill")).toEqual(["bash-kill"])
		})

		it("expands web tool aliases", () => {
			const fetchNames = loopToolToOpenCodeNames("web-fetch")
			expect(fetchNames).toContain("webfetch")
			expect(fetchNames).toContain("web-fetch")
			expect(fetchNames).toContain("web_fetch")
		})

		it("falls back to the loop name for unknown tools", () => {
			expect(loopToolToOpenCodeNames("custom_thing")).toEqual(["custom_thing"])
		})
	})

	describe("transformOpenCodeToolInput", () => {
		it("duplicates path → file_path for read", () => {
			const out = transformOpenCodeToolInput("read", { path: "/a/b.ts" })
			expect(out.path).toBe("/a/b.ts")
			expect(out.file_path).toBe("/a/b.ts")
		})

		it("duplicates path → file_path for edit/write/multiedit/apply-patch", () => {
			for (const tool of ["edit", "write", "multiedit", "apply-patch"]) {
				const out = transformOpenCodeToolInput(tool, { path: "/foo.ts" })
				expect(out.file_path, tool).toBe("/foo.ts")
			}
		})

		it("normalises bash command/cmd alias", () => {
			const out = transformOpenCodeToolInput("bash", { command: "ls -al" })
			expect(out.command).toBe("ls -al")
			expect(out.cmd).toBe("ls -al")
		})

		it("normalises grep pattern variants", () => {
			const out = transformOpenCodeToolInput("grep", { regex: "foo", directory: "/x" })
			expect(out.pattern).toBe("foo")
			expect(out.path).toBe("/x")
		})

		it("normalises task subagent_type aliases", () => {
			const out = transformOpenCodeToolInput("task", {
				name: "Investigate logs",
				instructions: "Explore",
				subagentType: "explore",
			})
			expect(out.description).toBe("Investigate logs")
			expect(out.prompt).toBe("Explore")
			expect(out.subagent_type).toBe("explore")
		})

		it("returns input unchanged for unknown tools", () => {
			const out = transformOpenCodeToolInput("custom-mcp", { x: 1, y: 2 })
			expect(out).toEqual({ x: 1, y: 2 })
		})

		it("returns empty object for missing input", () => {
			expect(transformOpenCodeToolInput("read", undefined)).toEqual({})
		})
	})

	describe("extractOpenCodeToolMetadata", () => {
		it("extracts edit diff stats from structured", () => {
			const meta = extractOpenCodeToolMetadata("edit", {
				structured: { diff: "@@ ...", additions: 3, deletions: 1, editCount: 2 },
				title: "Edit foo.ts",
			})
			expect(meta.diff).toBe("@@ ...")
			expect(meta.additions).toBe(3)
			expect(meta.deletions).toBe(1)
			expect(meta.editCount).toBe(2)
			expect(meta.description).toBe("Edit foo.ts")
		})

		it("extracts bash exit code + output", () => {
			const meta = extractOpenCodeToolMetadata("bash", {
				structured: { exitCode: 0, status: "ok" },
				output: "hello world",
			})
			expect(meta.exitCode).toBe(0)
			expect(meta.status).toBe("ok")
			expect(meta.output).toBe("hello world")
		})

		it("extracts read file metadata", () => {
			const meta = extractOpenCodeToolMetadata("read", {
				structured: { totalLines: 100, hasMore: true },
			})
			expect(meta.totalLines).toBe(100)
			expect(meta.hasMore).toBe(true)
		})

		it("extracts plan-exit content from output when structured missing", () => {
			const meta = extractOpenCodeToolMetadata("plan-exit", {
				output: "# Plan\n1. Step",
				input: { path: "/.loop/plans/foo.md" },
			})
			expect(meta.planContent).toBe("# Plan\n1. Step")
			expect(meta.planPath).toBe("/.loop/plans/foo.md")
		})

		it("prefers structured.todos over input.todos", () => {
			const meta = extractOpenCodeToolMetadata("todowrite", {
				input: { todos: [{ content: "old", status: "pending" }] },
				structured: { todos: [{ content: "new", status: "completed" }] },
			})
			expect(meta.todos).toEqual([{ content: "new", status: "completed" }])
		})

		it("returns empty object for unknown tools", () => {
			expect(extractOpenCodeToolMetadata("custom-mcp", { output: "x" })).toEqual({})
		})
	})

	describe("buildOpenCodePlanReminder", () => {
		it("does NOT instruct the model to call plan_write or plan_exit", () => {
			// OpenCode does not advertise these tools — calling them produces a
			// "Model tried to call unavailable tool 'plan_write'" error and
			// wastes a turn. The reminder MUST steer the model away.
			const reminder = buildOpenCodePlanReminder("/.loop/plans/foo.md", undefined)
			// The reminder explicitly says not to call them; check the absence
			// of imperative instructions to call them.
			expect(reminder).not.toMatch(/call\s+plan_write/i)
			expect(reminder).not.toMatch(/call\s+plan_exit/i)
			expect(reminder).not.toMatch(/use the plan_write tool/i)
			// And it explicitly tells the model these tools don't exist:
			expect(reminder).toContain("do NOT call")
			expect(reminder).toContain("plan_write")
			expect(reminder).toContain("plan_exit")
		})

		it("references the plan file path for both fresh and existing plans", () => {
			const path = "/.loop/plans/01HEXAMPLE.md"
			const fresh = buildOpenCodePlanReminder(path, undefined)
			const existing = buildOpenCodePlanReminder(path, "# Old plan")
			expect(fresh).toContain(path)
			expect(existing).toContain(path)
			expect(fresh).toContain("No plan file exists yet")
			expect(existing).toContain("plan file already exists")
		})

		it("instructs the model to produce the plan as final assistant text", () => {
			const reminder = buildOpenCodePlanReminder("/.loop/plans/foo.md", undefined)
			expect(reminder).toMatch(/final assistant response|final response/i)
			expect(reminder).toContain("Plan mode is active")
		})
	})
})

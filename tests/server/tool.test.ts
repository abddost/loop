import { describe, it, expect, vi, beforeEach } from "vitest"
import { filterTools } from "@server/tool/filter"
import { checkPermission } from "@server/tool/permission"
import type { ModelInfo } from "@core/schema/provider"
import type { Tool } from "@server/tool/shape"

// ─── Helpers ──────────────────────────────────────────────────

function makeTool(id: string): Tool.Shape {
	return {
		id,
		init: (agent?: string) => ({
			description: `${id} tool`,
			parameters: {} as any,
			execute: async () => ({ output: "ok" }),
		}),
	}
}

function makeModelInfo(overrides: Partial<ModelInfo> = {}): ModelInfo {
	return {
		id: "test-model",
		name: "Test Model",
		providerId: "test",
		contextWindow: 100_000,
		maxOutput: 8000,
		supportsImages: true,
		supportsTools: true,
		supportsReasoning: false,
		pricing: { input: 1, output: 2 },
		...overrides,
	}
}

function makeAgent(
	overrides: Partial<{
		name: string
		permission: { mode: string; rules: Array<{ tool: string; allow: boolean }> }
	}> = {},
) {
	return {
		name: overrides.name ?? "test-agent",
		permission: overrides.permission ?? { mode: "default", rules: [] },
	}
}

// ─── filterTools ──────────────────────────────────────────────

describe("filterTools", () => {
	const tools = [makeTool("bash"), makeTool("read"), makeTool("write"), makeTool("glob")]

	it("returns empty when model does not support tools", () => {
		const result = filterTools(tools, makeAgent(), makeModelInfo({ supportsTools: false }))
		expect(result).toEqual([])
	})

	it("returns all tools with allow-all agent and supporting model", () => {
		const agent = makeAgent({
			permission: { mode: "allow-all", rules: [] },
		})
		const result = filterTools(tools, agent, makeModelInfo())
		expect(result).toHaveLength(4)
	})

	it("filters out explicitly denied tools", () => {
		const agent = makeAgent({
			permission: {
				mode: "default",
				rules: [{ tool: "bash", allow: false }],
			},
		})
		const result = filterTools(tools, agent, makeModelInfo())
		expect(result).toHaveLength(3)
		expect(result.find((t) => t.id === "bash")).toBeUndefined()
	})

	it("keeps tools that have an allow rule", () => {
		const agent = makeAgent({
			permission: {
				mode: "default",
				rules: [{ tool: "bash", allow: true }],
			},
		})
		const result = filterTools(tools, agent, makeModelInfo())
		expect(result).toHaveLength(4)
		expect(result.find((t) => t.id === "bash")).toBeDefined()
	})

	it("returns all tools when agent has no deny rules", () => {
		const agent = makeAgent({ permission: { mode: "default", rules: [] } })
		const result = filterTools(tools, agent, makeModelInfo())
		expect(result).toHaveLength(4)
	})
})

// ─── checkPermission ──────────────────────────────────────────

describe("checkPermission", () => {
	it("returns true for allow-all mode", () => {
		const result = checkPermission("bash", { command: "ls" }, { mode: "allow-all", rules: [] })
		expect(result).toBe(true)
	})

	it("returns null for ask-always mode (needs confirmation)", () => {
		const result = checkPermission("bash", { command: "ls" }, { mode: "ask-always", rules: [] })
		expect(result).toBeNull()
	})

	it("returns true for safe tools in default mode", () => {
		for (const tool of ["read", "glob", "grep", "list"]) {
			const result = checkPermission(tool, {}, { mode: "default", rules: [] })
			expect(result).toBe(true)
		}
	})

	it("returns null for unsafe tools in default mode", () => {
		for (const tool of ["bash", "write", "edit"]) {
			const result = checkPermission(tool, {}, { mode: "default", rules: [] })
			expect(result).toBeNull()
		}
	})

	it("returns false for explicit deny rule", () => {
		const result = checkPermission(
			"bash",
			{ command: "rm -rf /" },
			{ mode: "default", rules: [{ tool: "bash", allow: false }] },
		)
		expect(result).toBe(false)
	})

	it("returns true for explicit allow rule", () => {
		const result = checkPermission(
			"write",
			{ path: "/a.txt" },
			{ mode: "default", rules: [{ tool: "write", allow: true }] },
		)
		expect(result).toBe(true)
	})

	it("matches bash prefix rule when command starts with prefix", () => {
		const result = checkPermission(
			"bash",
			{ command: "git status" },
			{ mode: "default", rules: [{ tool: "bash", allow: true, prefix: "git " }] },
		)
		expect(result).toBe(true)
	})

	it("does not match bash prefix rule when command does not start with prefix", () => {
		const result = checkPermission(
			"bash",
			{ command: "rm -rf /" },
			{ mode: "default", rules: [{ tool: "bash", allow: true, prefix: "git " }] },
		)
		// Falls through to default mode check for unsafe tool
		expect(result).toBeNull()
	})

	it("prefix rule on non-bash tool is treated as regular rule", () => {
		const result = checkPermission(
			"write",
			{ path: "/a.txt" },
			{ mode: "default", rules: [{ tool: "write", allow: true, prefix: "/safe/" }] },
		)
		// prefix is only checked for bash tool, so this is a normal allow rule
		expect(result).toBe(true)
	})

	it("checks rules in order, first matching rule wins", () => {
		const result = checkPermission(
			"bash",
			{ command: "git push" },
			{
				mode: "default",
				rules: [
					{ tool: "bash", allow: true, prefix: "git " },
					{ tool: "bash", allow: false },
				],
			},
		)
		expect(result).toBe(true)
	})

	it("deny prefix rule for bash", () => {
		const result = checkPermission(
			"bash",
			{ command: "rm -rf /" },
			{ mode: "default", rules: [{ tool: "bash", allow: false, prefix: "rm " }] },
		)
		expect(result).toBe(false)
	})
})

// ─── ToolRegistry ─────────────────────────────────────────────

describe("ToolRegistry", () => {
	// We import it dynamically to test its actual state
	it("all() returns all registered tools", async () => {
		const { ToolRegistry } = await import("@server/tool/registry")
		const tools = ToolRegistry.all()
		expect(tools.length).toBeGreaterThan(0)
		// Check some known builtins
		const ids = tools.map((t) => t.id)
		expect(ids).toContain("bash")
		expect(ids).toContain("read")
		expect(ids).toContain("write")
		expect(ids).toContain("edit")
		expect(ids).toContain("glob")
		expect(ids).toContain("grep")
	})

	it("get() returns a tool by ID", async () => {
		const { ToolRegistry } = await import("@server/tool/registry")
		const bash = ToolRegistry.get("bash")
		expect(bash).toBeDefined()
		expect(bash!.id).toBe("bash")
	})

	it("get() returns undefined for unknown tool", async () => {
		const { ToolRegistry } = await import("@server/tool/registry")
		expect(ToolRegistry.get("nonexistent")).toBeUndefined()
	})

	it("resolve() filters tools by agent and model", async () => {
		const { ToolRegistry } = await import("@server/tool/registry")
		const agent = makeAgent({
			permission: { mode: "default", rules: [{ tool: "bash", allow: false }] },
		})
		const modelInfo = makeModelInfo()
		const resolved = ToolRegistry.resolve(agent, modelInfo)
		const ids = resolved.map((t) => t.id)
		expect(ids).not.toContain("bash")
	})

	it("resolve() returns empty for model without tool support", async () => {
		const { ToolRegistry } = await import("@server/tool/registry")
		const resolved = ToolRegistry.resolve(
			makeAgent(),
			makeModelInfo({ supportsTools: false }),
		)
		expect(resolved).toEqual([])
	})
})

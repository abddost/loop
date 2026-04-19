import type { PermissionRuleset } from "@core/schema/permission"
import type { ModelInfo } from "@core/schema/provider"
import { BashArity } from "@server/permission/arity"
import { disabledTools, evaluate } from "@server/permission/evaluate"
import { Wildcard } from "@server/permission/wildcard"
import { filterTools } from "@server/tool/filter"
import type { Tool } from "@server/tool/shape"
import { describe, expect, it } from "vitest"

// ─── Helpers ──────────────────────────────────────────────────

function makeTool(id: string): Tool.Shape {
	return {
		id,
		init: (_agent?: string) => ({
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

// ─── Wildcard ─────────────────────────────────────────────────

describe("Wildcard", () => {
	it("matches exact strings", () => {
		expect(Wildcard.match("bash", "bash")).toBe(true)
		expect(Wildcard.match("bash", "edit")).toBe(false)
	})

	it("matches * wildcard", () => {
		expect(Wildcard.match("bash", "*")).toBe(true)
		expect(Wildcard.match("anything", "*")).toBe(true)
	})

	it("matches glob patterns", () => {
		expect(Wildcard.match("src/foo.ts", "src/**")).toBe(true)
		expect(Wildcard.match("src/foo.ts", "*.ts")).toBe(true)
		expect(Wildcard.match(".env", "*.env")).toBe(true)
	})

	it("matches ? single character", () => {
		expect(Wildcard.match("cat", "c?t")).toBe(true)
		expect(Wildcard.match("ct", "c?t")).toBe(false)
	})

	it("trailing space-star makes args optional", () => {
		expect(Wildcard.match("git checkout", "git checkout *")).toBe(true)
		expect(Wildcard.match("git checkout feature", "git checkout *")).toBe(true)
		expect(Wildcard.match("git", "git checkout *")).toBe(false)
	})
})

// ─── BashArity ────────────────────────────────────────────────

describe("BashArity", () => {
	it("returns single token for simple commands", () => {
		expect(BashArity.prefix(["ls", "-la"])).toEqual(["ls"])
		expect(BashArity.prefix(["cat", "file.txt"])).toEqual(["cat"])
	})

	it("returns multi-token for compound commands", () => {
		expect(BashArity.prefix(["git", "checkout", "-b", "feature"])).toEqual(["git", "checkout"])
		expect(BashArity.prefix(["npm", "run", "test"])).toEqual(["npm", "run", "test"])
		expect(BashArity.prefix(["bun", "run", "dev"])).toEqual(["bun", "run", "dev"])
	})

	it("returns empty for empty input", () => {
		expect(BashArity.prefix([])).toEqual([])
	})

	it("falls back to first token for unknown commands", () => {
		expect(BashArity.prefix(["mycustomcmd", "arg1"])).toEqual(["mycustomcmd"])
	})
})

// ─── evaluate ─────────────────────────────────────────────────

describe("evaluate", () => {
	it("returns default 'ask' when no rules match", () => {
		const result = evaluate("bash", "ls", [])
		expect(result.action).toBe("ask")
	})

	it("matches exact permission and wildcard pattern", () => {
		const ruleset: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "allow" }]
		const result = evaluate("bash", "ls", ruleset)
		expect(result.action).toBe("allow")
	})

	it("uses last-match-wins semantics", () => {
		const ruleset: PermissionRuleset = [
			{ permission: "bash", pattern: "*", action: "allow" },
			{ permission: "bash", pattern: "*", action: "deny" },
		]
		const result = evaluate("bash", "ls", ruleset)
		expect(result.action).toBe("deny")
	})

	it("matches wildcard permission", () => {
		const ruleset: PermissionRuleset = [{ permission: "*", pattern: "*", action: "allow" }]
		const result = evaluate("bash", "ls", ruleset)
		expect(result.action).toBe("allow")
	})

	it("matches specific pattern over wildcard", () => {
		const ruleset: PermissionRuleset = [
			{ permission: "edit", pattern: "*", action: "ask" },
			{ permission: "edit", pattern: "src/**", action: "allow" },
		]
		expect(evaluate("edit", "src/foo.ts", ruleset).action).toBe("allow")
		expect(evaluate("edit", "config.json", ruleset).action).toBe("ask")
	})

	it("merges multiple rulesets", () => {
		const defaults: PermissionRuleset = [{ permission: "*", pattern: "*", action: "allow" }]
		const agent: PermissionRuleset = [{ permission: "edit", pattern: "*", action: "deny" }]
		expect(evaluate("edit", "file.ts", defaults, agent).action).toBe("deny")
		expect(evaluate("read", "file.ts", defaults, agent).action).toBe("allow")
	})
})

// ─── disabledTools ────────────────────────────────────────────

describe("disabledTools", () => {
	it("returns empty set when no tools are denied", () => {
		const ruleset: PermissionRuleset = [{ permission: "*", pattern: "*", action: "allow" }]
		const result = disabledTools(["bash", "read", "edit"], ruleset)
		expect(result.size).toBe(0)
	})

	it("finds tools denied with * pattern", () => {
		const ruleset: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "deny" }]
		const result = disabledTools(["bash", "read", "edit"], ruleset)
		expect(result.has("bash")).toBe(true)
		expect(result.has("read")).toBe(false)
	})

	it("maps write to edit permission", () => {
		const ruleset: PermissionRuleset = [{ permission: "edit", pattern: "*", action: "deny" }]
		const result = disabledTools(["bash", "write", "edit"], ruleset)
		expect(result.has("write")).toBe(true)
		expect(result.has("edit")).toBe(true)
	})
})

// ─── filterTools ──────────────────────────────────────────────

describe("filterTools", () => {
	const tools = [makeTool("bash"), makeTool("read"), makeTool("write"), makeTool("glob")]

	it("returns empty when model does not support tools", () => {
		const result = filterTools(tools, [], makeModelInfo({ supportsTools: false }))
		expect(result).toEqual([])
	})

	it("returns all tools with empty ruleset", () => {
		const result = filterTools(tools, [], makeModelInfo())
		expect(result).toHaveLength(4)
	})

	it("filters out tools denied in ruleset", () => {
		const ruleset: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "deny" }]
		const result = filterTools(tools, ruleset, makeModelInfo())
		expect(result).toHaveLength(3)
		expect(result.find((t) => t.id === "bash")).toBeUndefined()
	})

	it("keeps tools not explicitly denied", () => {
		const ruleset: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "ask" }]
		const result = filterTools(tools, ruleset, makeModelInfo())
		expect(result).toHaveLength(4)
	})
})

// ─── ToolRegistry ─────────────────────────────────────────────

describe("ToolRegistry", () => {
	it("all() returns all registered tools", async () => {
		const { ToolRegistry } = await import("@server/tool/registry")
		const tools = ToolRegistry.all()
		expect(tools.length).toBeGreaterThan(0)
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

	it("resolve() filters tools by ruleset and model", async () => {
		const { ToolRegistry } = await import("@server/tool/registry")
		const ruleset: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "deny" }]
		const modelInfo = makeModelInfo()
		const resolved = ToolRegistry.resolve(ruleset, modelInfo)
		const ids = resolved.map((t) => t.id)
		expect(ids).not.toContain("bash")
	})

	it("resolve() returns empty for model without tool support", async () => {
		const { ToolRegistry } = await import("@server/tool/registry")
		const resolved = ToolRegistry.resolve([], makeModelInfo({ supportsTools: false }))
		expect(resolved).toEqual([])
	})
})

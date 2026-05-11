import { type SlashCommandRow, rankSlashCommands } from "@app/components/input/slash-command-menu"
import { describe, expect, it } from "vitest"

const COMMANDS: SlashCommandRow[] = [
	{ name: "clear", description: "Clear conversation history", argumentHint: "" },
	{ name: "compact", description: "Compact conversation", argumentHint: "[instructions]" },
	{ name: "cost", description: "Show token usage and cost", argumentHint: "" },
	{ name: "model", description: "Switch model", argumentHint: "[model]" },
	{ name: "memory", description: "Edit memory files", argumentHint: "" },
	{ name: "init", description: "Initialize CLAUDE.md", argumentHint: "" },
	{ name: "help", description: "Show help", argumentHint: "" },
]

describe("rankSlashCommands", () => {
	it("returns all commands alphabetically when query is empty", () => {
		const result = rankSlashCommands(COMMANDS, "")
		expect(result.map((r) => r.name)).toEqual([
			"clear",
			"compact",
			"cost",
			"help",
			"init",
			"memory",
			"model",
		])
	})

	it("scores exact name matches highest", () => {
		const result = rankSlashCommands(COMMANDS, "clear")
		expect(result[0].name).toBe("clear")
	})

	it("prefers prefix matches over substring matches", () => {
		const result = rankSlashCommands(COMMANDS, "co")
		// "compact" and "cost" both start with "co" — both rank above
		// commands where "co" is buried in the description.
		expect(result.slice(0, 2).map((r) => r.name).sort()).toEqual(["compact", "cost"])
	})

	it("falls back to description matches", () => {
		const result = rankSlashCommands(COMMANDS, "history")
		expect(result[0].name).toBe("clear")
	})

	it("supports fuzzy subsequence over the name", () => {
		// "mdl" → "m_o_d_e_l" subsequence
		const result = rankSlashCommands(COMMANDS, "mdl")
		expect(result.length).toBeGreaterThan(0)
		expect(result[0].name).toBe("model")
	})

	it("returns empty array for unmatched queries", () => {
		expect(rankSlashCommands(COMMANDS, "xyzzy")).toEqual([])
	})

	it("respects the limit parameter", () => {
		const result = rankSlashCommands(COMMANDS, "", 3)
		expect(result).toHaveLength(3)
	})
})

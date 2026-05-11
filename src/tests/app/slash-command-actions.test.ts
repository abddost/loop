import { parseSlashCommandLine } from "@app/components/input/slash-command-actions"
import { describe, expect, it } from "vitest"

describe("parseSlashCommandLine", () => {
	it("parses a bare command with no args", () => {
		expect(parseSlashCommandLine("/usage")).toEqual({ name: "usage", args: "" })
		expect(parseSlashCommandLine("/clear")).toEqual({ name: "clear", args: "" })
	})

	it("parses a command followed by args", () => {
		expect(parseSlashCommandLine("/usage 30d")).toEqual({ name: "usage", args: "30d" })
		expect(parseSlashCommandLine("/compact summarize the thread")).toEqual({
			name: "compact",
			args: "summarize the thread",
		})
	})

	it("trims surrounding whitespace from the line and the args", () => {
		expect(parseSlashCommandLine("  /usage   7d  ")).toEqual({ name: "usage", args: "7d" })
	})

	it("handles plugin-namespaced command names (colon in the name)", () => {
		expect(parseSlashCommandLine("/ccc-skills:streak go")).toEqual({
			name: "ccc-skills:streak",
			args: "go",
		})
	})

	it("returns null for lines that don't start with a slash", () => {
		expect(parseSlashCommandLine("hello /usage")).toBeNull()
		expect(parseSlashCommandLine("just text")).toBeNull()
		expect(parseSlashCommandLine("")).toBeNull()
	})

	it("returns null for a lone slash with no command name", () => {
		expect(parseSlashCommandLine("/")).toBeNull()
		expect(parseSlashCommandLine("  /  ")).toBeNull()
	})

	it("splits on the first whitespace run only (tabs, multiple spaces)", () => {
		expect(parseSlashCommandLine("/usage\t30d")).toEqual({ name: "usage", args: "30d" })
		expect(parseSlashCommandLine("/x  a  b  c")).toEqual({ name: "x", args: "a  b  c" })
	})
})

import { findSlashCommandContext } from "@app/components/input/slash-trigger"
import { describe, expect, it } from "vitest"

describe("findSlashCommandContext", () => {
	it("matches `/` at the start of input", () => {
		expect(findSlashCommandContext("/", 1)).toEqual({ start: 0, end: 1, query: "" })
		expect(findSlashCommandContext("/clear", 6)).toEqual({ start: 0, end: 6, query: "clear" })
	})

	it("matches `/` immediately after a newline", () => {
		const text = "do this\n/com"
		expect(findSlashCommandContext(text, text.length)).toEqual({
			start: 8,
			end: 12,
			query: "com",
		})
	})

	it("does NOT trigger for `/` mid-word (e.g. URLs)", () => {
		expect(findSlashCommandContext("https://example.com", 19)).toBeNull()
		expect(findSlashCommandContext("a/b", 3)).toBeNull()
	})

	it("does NOT trigger for `/` after a space (must be at line start)", () => {
		expect(findSlashCommandContext("hello /clear", 12)).toBeNull()
	})

	it("closes when whitespace appears in the query", () => {
		// Once the user types `/compact ` (trailing space) the menu should
		// close so the rest of the line is freeform args.
		expect(findSlashCommandContext("/compact ", 9)).toBeNull()
		expect(findSlashCommandContext("/compact summarize", 18)).toBeNull()
	})

	it("treats the cursor position as the right edge of the query", () => {
		// Cursor in the middle of the typed query — query is truncated.
		expect(findSlashCommandContext("/compact", 4)).toEqual({
			start: 0,
			end: 4,
			query: "com",
		})
	})

	it("returns null for invalid cursor positions", () => {
		expect(findSlashCommandContext("/clear", -1)).toBeNull()
		expect(findSlashCommandContext("/clear", 999)).toBeNull()
	})
})

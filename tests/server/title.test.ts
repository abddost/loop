import { deriveTitleFromUserMessage } from "@server/loop/title"
import { describe, expect, it } from "vitest"

describe("deriveTitleFromUserMessage", () => {
	it("returns trimmed text from a single text part", () => {
		expect(deriveTitleFromUserMessage({ parts: [{ type: "text", text: "fix login bug" }] })).toBe(
			"fix login bug",
		)
	})

	it("collapses whitespace and joins multiple text parts", () => {
		expect(
			deriveTitleFromUserMessage({
				parts: [
					{ type: "text", text: "  refactor   the\nauth " },
					{ type: "text", text: "module" },
				],
			}),
		).toBe("refactor the auth module")
	})

	it("truncates long text at a word boundary", () => {
		const long = "implement a comprehensive rate limiter for the api gateway service"
		const result = deriveTitleFromUserMessage({ parts: [{ type: "text", text: long }] })
		expect(result.length).toBeLessThanOrEqual(50)
		expect(result.endsWith(" ")).toBe(false)
		expect(long.startsWith(result)).toBe(true)
	})

	it("falls back to file basename when only a file part is present", () => {
		expect(
			deriveTitleFromUserMessage({
				parts: [{ type: "file", path: "/tmp/screenshots/error.png" }],
			}),
		).toBe("File: error.png")
	})

	it("uses file basename for windows-style paths", () => {
		expect(
			deriveTitleFromUserMessage({
				parts: [{ type: "file", path: "C:\\Users\\me\\image.jpg" }],
			}),
		).toBe("File: image.jpg")
	})

	it("prefers text over file when both are present", () => {
		expect(
			deriveTitleFromUserMessage({
				parts: [
					{ type: "text", text: "look at this" },
					{ type: "file", path: "/x/y.png" },
				],
			}),
		).toBe("look at this")
	})

	it("falls back to file when text parts are empty strings", () => {
		expect(
			deriveTitleFromUserMessage({
				parts: [
					{ type: "text", text: "   " },
					{ type: "file", path: "/x/y.png" },
				],
			}),
		).toBe("File: y.png")
	})

	it("returns 'New session' when parts is empty", () => {
		expect(deriveTitleFromUserMessage({ parts: [] })).toBe("New session")
	})

	it("returns 'New session' when parts is undefined", () => {
		expect(deriveTitleFromUserMessage({})).toBe("New session")
	})

	it("returns 'New session' when no usable text or file is present", () => {
		expect(deriveTitleFromUserMessage({ parts: [{ type: "compaction" }] as never })).toBe(
			"New session",
		)
	})

	it("caps file label at 50 chars when basename is very long", () => {
		const longName = `${"x".repeat(80)}.png`
		const result = deriveTitleFromUserMessage({
			parts: [{ type: "file", path: `/tmp/${longName}` }],
		})
		expect(result.length).toBeLessThanOrEqual(50)
		expect(result.startsWith("File: ")).toBe(true)
	})
})

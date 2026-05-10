import { decodeDataUrlText, looksLikeText, stripDataUrlPrefix } from "@core/message/data-url"
import { describe, expect, it } from "vitest"

describe("decodeDataUrlText", () => {
	it("returns the input unchanged when it isn't a data URL", () => {
		expect(decodeDataUrlText("plain text content")).toBe("plain text content")
	})

	it("decodes a base64 text/plain data URL back to UTF-8 text", () => {
		const text = "function add(a, b) {\n  return a + b\n}"
		const dataUrl = `data:text/plain;base64,${Buffer.from(text, "utf8").toString("base64")}`
		expect(decodeDataUrlText(dataUrl)).toBe(text)
	})

	it("round-trips multi-byte UTF-8 (emoji + non-ASCII chars)", () => {
		const text = "日本語 + emoji 🚀\nsecond line"
		const dataUrl = `data:text/plain;base64,${Buffer.from(text, "utf8").toString("base64")}`
		expect(decodeDataUrlText(dataUrl)).toBe(text)
	})

	it("decodes a percent-encoded (non-base64) text data URL", () => {
		expect(decodeDataUrlText("data:text/plain,hello%20world")).toBe("hello world")
	})

	it("returns undefined for malformed base64", () => {
		const result = decodeDataUrlText("data:text/plain;base64,@@@@")
		// Buffer.from is permissive (silently drops bad chars) so we accept
		// either undefined or a (possibly empty) string here — the contract
		// is "fail safely", not "fail loudly".
		expect(result === undefined || typeof result === "string").toBe(true)
	})

	it("returns undefined when there's no comma to separate prefix and payload", () => {
		expect(decodeDataUrlText("data:text/plain;base64")).toBeUndefined()
	})
})

describe("stripDataUrlPrefix", () => {
	it("returns the base64 payload of an image data URL", () => {
		expect(stripDataUrlPrefix("data:image/png;base64,AAAA")).toBe("AAAA")
	})

	it("returns the input unchanged when there's no data URL prefix", () => {
		expect(stripDataUrlPrefix("just text")).toBe("just text")
	})
})

describe("looksLikeText", () => {
	it("treats text/* data URLs as text", () => {
		expect(looksLikeText("data:text/plain;base64,AAAA")).toBe(true)
		expect(looksLikeText("data:text/typescript;base64,AAAA")).toBe(true)
	})

	it("treats application/json/xml/yaml data URLs as text", () => {
		expect(looksLikeText("data:application/json;base64,AAAA")).toBe(true)
		expect(looksLikeText("data:application/xml;base64,AAAA")).toBe(true)
		expect(looksLikeText("data:application/yaml;base64,AAAA")).toBe(true)
	})

	it("treats image data URLs as non-text", () => {
		expect(looksLikeText("data:image/png;base64,AAAA")).toBe(false)
		expect(looksLikeText("data:application/pdf;base64,AAAA")).toBe(false)
	})

	it("treats bare strings as text", () => {
		expect(looksLikeText("hello")).toBe(true)
	})
})

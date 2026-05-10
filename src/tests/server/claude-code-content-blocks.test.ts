import { describe, expect, it } from "vitest"
import type { FilePart, TextPart } from "../../core/schema/part"
import { buildClaudeCodeContent } from "../../server/loop/claude-code/content-blocks"

describe("buildClaudeCodeContent", () => {
	it("returns text blocks for text parts and skips empties", () => {
		const parts: Array<TextPart | FilePart> = [
			{ type: "text", text: "what does this do?" },
			{ type: "text", text: "   " },
			{ type: "text", text: "follow-up" },
		]
		const blocks = buildClaudeCodeContent(parts)
		expect(blocks).toEqual([
			{ type: "text", text: "what does this do?" },
			{ type: "text", text: "follow-up" },
		])
	})

	it("converts an image data URL into an Anthropic image block", () => {
		const parts: Array<TextPart | FilePart> = [
			{ type: "text", text: "what's in this image?" },
			{
				type: "file",
				path: "shot.png",
				mimeType: "image/png",
				content: "data:image/png;base64,AAAA",
			},
		]
		const blocks = buildClaudeCodeContent(parts)
		expect(blocks).toEqual([
			{ type: "text", text: "what's in this image?" },
			{
				type: "image",
				source: { type: "base64", media_type: "image/png", data: "AAAA" },
			},
		])
	})

	it("converts a PDF file into a document block", () => {
		const parts: Array<TextPart | FilePart> = [
			{
				type: "file",
				path: "spec.pdf",
				mimeType: "application/pdf",
				content: "data:application/pdf;base64,JVBER",
			},
		]
		const blocks = buildClaudeCodeContent(parts)
		expect(blocks).toEqual([
			{
				type: "document",
				source: { type: "base64", media_type: "application/pdf", data: "JVBER" },
			},
		])
	})

	it("inlines a directory listing as a text block (truncated to 4 KB)", () => {
		const big = "x".repeat(5000)
		const parts: Array<TextPart | FilePart> = [
			{
				type: "file",
				path: "/repo",
				mimeType: "application/x-directory",
				content: big,
			},
		]
		const [block] = buildClaudeCodeContent(parts)
		expect(block).toMatchObject({ type: "text" })
		expect((block as { text: string }).text.startsWith("[Directory attached: /repo]\n")).toBe(true)
		expect((block as { text: string }).text.length).toBe(
			"[Directory attached: /repo]\n".length + 4000,
		)
	})

	it("inlines text-y files with a [File: ...] header", () => {
		const parts: Array<TextPart | FilePart> = [
			{ type: "text", text: "review this" },
			{
				type: "file",
				path: "src/x.ts",
				mimeType: "text/typescript",
				content: "export const a = 1",
			},
		]
		const blocks = buildClaudeCodeContent(parts)
		expect(blocks).toEqual([
			{ type: "text", text: "review this" },
			{ type: "text", text: "[File: src/x.ts]\nexport const a = 1" },
		])
	})

	it("falls back to a binary marker for unsupported types", () => {
		const parts: Array<TextPart | FilePart> = [
			{
				type: "file",
				path: "weird.bin",
				mimeType: "application/octet-stream",
				content: "data:application/octet-stream;base64,ZZZZ",
			},
		]
		const blocks = buildClaudeCodeContent(parts)
		expect(blocks).toEqual([
			{ type: "text", text: "[Binary file: weird.bin (application/octet-stream)]" },
		])
	})

	it("emits a marker text block for files whose content failed to resolve", () => {
		const parts: Array<TextPart | FilePart> = [
			{ type: "text", text: "hi" },
			{ type: "file", path: "missing.png", mimeType: "image/png", content: "" },
		]
		const blocks = buildClaudeCodeContent(parts)
		expect(blocks).toEqual([
			{ type: "text", text: "hi" },
			{ type: "text", text: "[Attached file: missing.png (image/png)]" },
		])
	})

	it("hides the synthetic x-loop-path mime in the marker when content is empty", () => {
		const parts: Array<TextPart | FilePart> = [
			{
				type: "file",
				path: "src/foo.ts",
				mimeType: "application/x-loop-path",
				content: "",
			},
		]
		const blocks = buildClaudeCodeContent(parts)
		expect(blocks).toEqual([{ type: "text", text: "[Attached file: src/foo.ts]" }])
	})

	it("produces a non-empty result for file-only prompts (no text)", () => {
		const parts: Array<TextPart | FilePart> = [
			{
				type: "file",
				path: "tsconfig.json",
				mimeType: "application/json",
				content: '{"compilerOptions": {}}',
			},
		]
		const blocks = buildClaudeCodeContent(parts)
		expect(blocks).toHaveLength(1)
		expect(blocks[0]).toMatchObject({
			type: "text",
			text: '[File: tsconfig.json]\n{"compilerOptions": {}}',
		})
	})

	it("preserves multimodal ordering across mixed parts", () => {
		const parts: Array<TextPart | FilePart> = [
			{ type: "text", text: "first" },
			{
				type: "file",
				path: "a.png",
				mimeType: "image/png",
				content: "data:image/png;base64,AAAA",
			},
			{ type: "text", text: "between" },
			{
				type: "file",
				path: "b.txt",
				mimeType: "text/plain",
				content: "hello",
			},
			{ type: "text", text: "last" },
		]
		const blocks = buildClaudeCodeContent(parts)
		const types = blocks.map((b) => b.type)
		expect(types).toEqual(["text", "image", "text", "text", "text"])
	})
})

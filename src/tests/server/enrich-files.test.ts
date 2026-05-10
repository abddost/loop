import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { enrichSubmissionFiles } from "@server/loop/enrich-files"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Tests for `enrichSubmissionFiles`, which resolves path-only attachments
 * (drag-from-file-tree) into self-contained FileParts before the user
 * message is persisted. All tests use absolute paths so Workspace.dir()
 * is never consulted.
 */

let tmp: string

beforeAll(async () => {
	tmp = await mkdtemp(join(tmpdir(), "loop2-enrich-"))
})

afterAll(async () => {
	await rm(tmp, { recursive: true, force: true })
})

describe("enrichSubmissionFiles", () => {
	it("returns undefined / empty input unchanged", async () => {
		expect(await enrichSubmissionFiles(undefined)).toBeUndefined()
		expect(await enrichSubmissionFiles([])).toEqual([])
	})

	it("reads a text file from disk and inlines its content", async () => {
		const path = join(tmp, "tsconfig.json")
		const body = '{"compilerOptions": {"strict": true}}'
		await writeFile(path, body, "utf8")

		const out = await enrichSubmissionFiles([
			{ path, mimeType: "application/x-loop-path", content: "" },
		])
		expect(out).toEqual([
			{ path, mimeType: "application/json", content: body },
		])
	})

	it("reads a binary file as a base64 data URL", async () => {
		const path = join(tmp, "tiny.png")
		const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		await writeFile(path, bytes)

		const [out] = (await enrichSubmissionFiles([
			{ path, mimeType: "application/x-loop-path", content: "" },
		]))!
		expect(out.mimeType).toBe("image/png")
		expect(out.content).toBe(`data:image/png;base64,${bytes.toString("base64")}`)
	})

	it("emits a marker text when the file is missing", async () => {
		const path = join(tmp, "does-not-exist.txt")
		const [out] = (await enrichSubmissionFiles([
			{ path, mimeType: "application/x-loop-path", content: "" },
		]))!
		expect(out.mimeType).toBe("text/plain")
		expect(out.content.startsWith(`[Attached file unavailable: ${path}`)).toBe(true)
	})

	it("emits a 'too large' marker when the file exceeds the inline limit", async () => {
		const path = join(tmp, "huge.bin")
		// 6 MB > 5 MB cap
		await writeFile(path, Buffer.alloc(6 * 1024 * 1024))

		const [out] = (await enrichSubmissionFiles([
			{ path, mimeType: "application/x-loop-path", content: "" },
		]))!
		expect(out.mimeType).toBe("text/plain")
		expect(out.content).toContain("[Attached file too large to inline:")
		expect(out.content).toContain(path)
	})

	it("populates directory parts with a listing of their entries", async () => {
		const dir = join(tmp, "subdir")
		await rm(dir, { recursive: true, force: true })
		await mkdtemp(join(tmp, "subdir-")).then(async (created) => {
			await writeFile(join(created, "a.txt"), "a", "utf8")
			await writeFile(join(created, "b.txt"), "b", "utf8")

			const [out] = (await enrichSubmissionFiles([
				{ path: created, mimeType: "application/x-directory", content: "" },
			]))!
			expect(out.mimeType).toBe("application/x-directory")
			expect(out.content).toContain(`--- Directory: ${created} ---`)
			expect(out.content).toContain("a.txt")
			expect(out.content).toContain("b.txt")
		})
	})

	it("emits an ERROR marker for a missing directory path", async () => {
		const out = await enrichSubmissionFiles([
			{ path: "/nope/does/not/exist", mimeType: "application/x-directory", content: "" },
		])
		expect(out![0].mimeType).toBe("application/x-directory")
		expect(out![0].content).toContain('ERROR: Failed to read directory "/nope/does/not/exist"')
	})

	it("skips files that already carry resolved content", async () => {
		const out = await enrichSubmissionFiles([
			{ path: "x.png", mimeType: "image/png", content: "data:image/png;base64,AAAA" },
		])
		expect(out).toEqual([
			{ path: "x.png", mimeType: "image/png", content: "data:image/png;base64,AAAA" },
		])
	})

	it("re-resolves files that have a resolved mime but empty content", async () => {
		// Edge case: client sent the right mime but didn't manage to read
		// the bytes. We should still try to resolve from disk.
		const path = join(tmp, "fallback.txt")
		await writeFile(path, "fallback contents", "utf8")

		const [out] = (await enrichSubmissionFiles([
			{ path, mimeType: "text/plain", content: "" },
		]))!
		expect(out.content).toBe("fallback contents")
	})
})

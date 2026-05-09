import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { type ResumeState, resolveResumeCursor } from "../../server/loop/claude-code/session"

/**
 * Unit tests for the Claude Code resume-cursor decision logic.
 *
 * `resolveResumeCursor` is the pure function the runtime uses to decide
 * whether a persisted SDK session id is still safe to hand back to
 * `query({ resume })`. It has three failure modes it must handle cleanly:
 *   1. No prior session id (first turn) → don't resume.
 *   2. Recorded cwd no longer exists on disk → don't resume (would crash SDK).
 *   3. Happy path: valid id + cwd still exists → resume.
 *
 * `readResumeState` and `persistResumeCursor` are thin DB wrappers covered
 * implicitly by the existing `db.test.ts` session-update suite — no need to
 * duplicate them here.
 */

describe("resolveResumeCursor", () => {
	it("returns shouldResume: false when no session id is stored", () => {
		const state: ResumeState = {
			claudeCodeSessionId: null,
			claudeCodeCwd: null,
			claudeCodeLastTurnId: null,
		}
		const result = resolveResumeCursor(state)
		expect(result.shouldResume).toBe(false)
		expect(result.reason).toBe("no prior session id")
		expect(result.resumeSessionId).toBeUndefined()
	})

	it("returns shouldResume: true when session id exists and cwd is not recorded", () => {
		// `cwd` being null means we never persisted one — treat as "safe to
		// resume" and let the caller fall back to `session.directory` for the
		// actual cwd the SDK will run in.
		const state: ResumeState = {
			claudeCodeSessionId: "sdk-sess-abc",
			claudeCodeCwd: null,
			claudeCodeLastTurnId: null,
		}
		const result = resolveResumeCursor(state)
		expect(result.shouldResume).toBe(true)
		expect(result.resumeSessionId).toBe("sdk-sess-abc")
	})

	it("returns shouldResume: true when cwd still exists on disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "loop-cc-session-"))
		try {
			const state: ResumeState = {
				claudeCodeSessionId: "sdk-sess-xyz",
				claudeCodeCwd: dir,
				claudeCodeLastTurnId: "msg-42",
			}
			const result = resolveResumeCursor(state)
			expect(result.shouldResume).toBe(true)
			expect(result.resumeSessionId).toBe("sdk-sess-xyz")
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("returns shouldResume: false when recorded cwd no longer exists", () => {
		const state: ResumeState = {
			claudeCodeSessionId: "sdk-sess-stale",
			claudeCodeCwd: "/definitely/not/a/real/path/for/tests-123456",
			claudeCodeLastTurnId: null,
		}
		const result = resolveResumeCursor(state)
		expect(result.shouldResume).toBe(false)
		expect(result.reason).toBe("cwd missing")
		expect(result.resumeSessionId).toBeUndefined()
	})
})

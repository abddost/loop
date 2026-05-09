import { describe, expect, it } from "vitest"
import { _reasonToHardRejectForTesting as reasonToHardReject } from "../../server/loop/cursor/permissions"

/**
 * Server-side enforcement: when the plan agent is active, mutating
 * tool calls must be hard-rejected before the user is ever prompted.
 * This guard is independent of the user's permission mode (full-access
 * does NOT bypass it) and independent of cursor's prompt-following.
 */

const SID = "01ABCDEFGHJKLMNPQRSTVWXYZ0"
const PLAN_FILE = `.loop/plans/${SID}.md`

describe("plan-mode hard-reject", () => {
	describe("non-plan agents are never hard-rejected", () => {
		it("build agent + edit on arbitrary path → no reject", () => {
			expect(
				reasonToHardReject({
					agentName: "build",
					loopSessionId: SID,
					kind: "edit",
					rawInput: { path: "src/foo.ts" },
					locations: undefined,
				}),
			).toBeUndefined()
		})

		it("undefined agent + execute rm → no reject", () => {
			expect(
				reasonToHardReject({
					agentName: undefined,
					loopSessionId: SID,
					kind: "execute",
					rawInput: { command: "rm -rf node_modules" },
					locations: undefined,
				}),
			).toBeUndefined()
		})
	})

	describe("plan agent + mutating tool kinds", () => {
		it("rejects edit on a non-plan path", () => {
			const reason = reasonToHardReject({
				agentName: "plan",
				loopSessionId: SID,
				kind: "edit",
				rawInput: { path: "src/foo.ts" },
				locations: undefined,
			})
			expect(reason).toBeDefined()
			expect(reason).toMatch(/Plan mode/)
			expect(reason).toMatch(/src\/foo\.ts/)
		})

		it("allows edit when target IS the plan file (rawInput.path)", () => {
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "edit",
					rawInput: { path: PLAN_FILE },
					locations: undefined,
				}),
			).toBeUndefined()
		})

		it("allows edit when target is the plan file (absolute)", () => {
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "edit",
					rawInput: { path: `/Users/me/project/${PLAN_FILE}` },
					locations: undefined,
				}),
			).toBeUndefined()
		})

		it("allows edit when target is the plan file (locations[0])", () => {
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "edit",
					rawInput: {},
					locations: [{ path: PLAN_FILE }],
				}),
			).toBeUndefined()
		})

		it("rejects edit when locations contains BOTH plan file and another path", () => {
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "edit",
					rawInput: {},
					locations: [{ path: PLAN_FILE }, { path: "src/foo.ts" }],
				}),
			).toBeDefined()
		})

		it("rejects edit with no resolvable target path", () => {
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "edit",
					rawInput: {},
					locations: undefined,
				}),
			).toBeDefined()
		})

		it("rejects delete and move kinds (not just edit)", () => {
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "delete",
					rawInput: { path: "src/foo.ts" },
					locations: undefined,
				}),
			).toBeDefined()
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "move",
					rawInput: { path: "src/foo.ts" },
					locations: undefined,
				}),
			).toBeDefined()
		})

		it("does NOT reject read or search kinds (those are inherently read-only)", () => {
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "read",
					rawInput: { path: "src/foo.ts" },
					locations: undefined,
				}),
			).toBeUndefined()
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "search",
					rawInput: { pattern: "todo" },
					locations: undefined,
				}),
			).toBeUndefined()
		})

		it("explore agent gets the same restriction as plan", () => {
			expect(
				reasonToHardReject({
					agentName: "explore",
					loopSessionId: SID,
					kind: "edit",
					rawInput: { path: "src/foo.ts" },
					locations: undefined,
				}),
			).toBeDefined()
		})
	})

	describe("plan agent + execute (bash)", () => {
		it("rejects rm", () => {
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "execute",
					rawInput: { command: "rm -rf src" },
					locations: undefined,
				}),
			).toBeDefined()
		})

		it("rejects mv, cp, chmod, mkdir, touch, sed, tee", () => {
			for (const cmd of [
				"mv a b",
				"cp a b",
				"chmod 755 x",
				"mkdir x",
				"touch x",
				"sed -i s/a/b/ x",
				"tee x",
			]) {
				expect(
					reasonToHardReject({
						agentName: "plan",
						loopSessionId: SID,
						kind: "execute",
						rawInput: { command: cmd },
						locations: undefined,
					}),
					`expected reject for: ${cmd}`,
				).toBeDefined()
			}
		})

		it("rejects package managers (npm, bun, pnpm, yarn, pip, cargo)", () => {
			for (const cmd of [
				"npm install",
				"bun add foo",
				"pnpm i",
				"yarn",
				"pip install x",
				"cargo build",
			]) {
				expect(
					reasonToHardReject({
						agentName: "plan",
						loopSessionId: SID,
						kind: "execute",
						rawInput: { command: cmd },
						locations: undefined,
					}),
					`expected reject for: ${cmd}`,
				).toBeDefined()
			}
		})

		it("rejects mutating git subcommands but ALLOWS read-only git", () => {
			for (const cmd of [
				"git commit -m foo",
				"git push",
				"git checkout main",
				"git reset --hard",
			]) {
				expect(
					reasonToHardReject({
						agentName: "plan",
						loopSessionId: SID,
						kind: "execute",
						rawInput: { command: cmd },
						locations: undefined,
					}),
					`expected reject for: ${cmd}`,
				).toBeDefined()
			}
			for (const cmd of ["git status", "git log", "git diff HEAD~1", "git show HEAD"]) {
				expect(
					reasonToHardReject({
						agentName: "plan",
						loopSessionId: SID,
						kind: "execute",
						rawInput: { command: cmd },
						locations: undefined,
					}),
					`expected allow for: ${cmd}`,
				).toBeUndefined()
			}
		})

		it("rejects redirection to file (>, >>, | tee)", () => {
			for (const cmd of ["echo foo > bar.txt", "echo foo >> bar.txt", "ls | tee out.txt"]) {
				expect(
					reasonToHardReject({
						agentName: "plan",
						loopSessionId: SID,
						kind: "execute",
						rawInput: { command: cmd },
						locations: undefined,
					}),
					`expected reject for: ${cmd}`,
				).toBeDefined()
			}
		})

		it("does NOT reject canonical read-only commands (ls, cat, grep, find, rg)", () => {
			for (const cmd of [
				"ls -la",
				"cat package.json",
				"grep -r foo src",
				"find . -name '*.ts'",
				"rg pattern",
			]) {
				expect(
					reasonToHardReject({
						agentName: "plan",
						loopSessionId: SID,
						kind: "execute",
						rawInput: { command: cmd },
						locations: undefined,
					}),
					`expected allow for: ${cmd}`,
				).toBeUndefined()
			}
		})

		it("strips path prefix from command (e.g. /usr/bin/rm)", () => {
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "execute",
					rawInput: { command: "/usr/bin/rm -rf x" },
					locations: undefined,
				}),
			).toBeDefined()
		})

		it("accepts cmd as alias for command", () => {
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "execute",
					rawInput: { cmd: "rm -rf x" },
					locations: undefined,
				}),
			).toBeDefined()
		})

		it("does not throw on empty/missing command", () => {
			expect(
				reasonToHardReject({
					agentName: "plan",
					loopSessionId: SID,
					kind: "execute",
					rawInput: {},
					locations: undefined,
				}),
			).toBeUndefined()
		})
	})

	describe("sessionPermissionMode === 'plan' triggers same enforcement", () => {
		it("rejects edit when sessionPermissionMode is 'plan' even without plan agent", () => {
			expect(
				reasonToHardReject({
					agentName: "build",
					sessionPermissionMode: "plan",
					loopSessionId: SID,
					kind: "edit",
					rawInput: { path: "src/foo.ts" },
					locations: undefined,
				}),
			).toBeDefined()
		})

		it("allows edit on plan file when sessionPermissionMode is 'plan'", () => {
			expect(
				reasonToHardReject({
					agentName: "build",
					sessionPermissionMode: "plan",
					loopSessionId: SID,
					kind: "edit",
					rawInput: { path: PLAN_FILE },
					locations: undefined,
				}),
			).toBeUndefined()
		})

		it("rejects mutating bash when sessionPermissionMode is 'plan'", () => {
			expect(
				reasonToHardReject({
					agentName: "build",
					sessionPermissionMode: "plan",
					loopSessionId: SID,
					kind: "execute",
					rawInput: { command: "rm -rf src" },
					locations: undefined,
				}),
			).toBeDefined()
		})

		it("does NOT reject when sessionPermissionMode is 'default' for build agent", () => {
			expect(
				reasonToHardReject({
					agentName: "build",
					sessionPermissionMode: "default",
					loopSessionId: SID,
					kind: "edit",
					rawInput: { path: "src/foo.ts" },
					locations: undefined,
				}),
			).toBeUndefined()
		})

		it("does NOT reject when sessionPermissionMode is 'full-access' for build agent", () => {
			expect(
				reasonToHardReject({
					agentName: "build",
					sessionPermissionMode: "full-access",
					loopSessionId: SID,
					kind: "edit",
					rawInput: { path: "src/foo.ts" },
					locations: undefined,
				}),
			).toBeUndefined()
		})

		it("plan agent + full-access does NOT bypass plan-mode enforcement", () => {
			// Even when the user toggled full-access, the plan agent's
			// identity wins: edits are still rejected.
			expect(
				reasonToHardReject({
					agentName: "plan",
					sessionPermissionMode: "full-access",
					loopSessionId: SID,
					kind: "edit",
					rawInput: { path: "src/foo.ts" },
					locations: undefined,
				}),
			).toBeDefined()
		})
	})
})

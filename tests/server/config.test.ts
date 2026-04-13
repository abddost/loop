import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock homedir to isolate tests from the real config
const TEST_HOME = join(tmpdir(), `loop-config-test-${process.pid}`)

vi.mock("node:os", async (importOriginal) => {
	const actual = (await importOriginal()) as typeof import("node:os")
	return {
		...actual,
		homedir: () => TEST_HOME,
	}
})

// Import AFTER mock is set up
const { read, write, path, ensure, invalidate } = await import("../../src/server/config")
const { DEFAULT_CONFIG } = await import("../../src/core/schema/config")

describe("Config module", () => {
	beforeEach(() => {
		mkdirSync(join(TEST_HOME, ".loop"), { recursive: true })
		invalidate()
	})

	afterEach(() => {
		rmSync(TEST_HOME, { recursive: true, force: true })
		invalidate()
	})

	describe("path()", () => {
		it("returns the config file path", () => {
			expect(path()).toBe(join(TEST_HOME, ".loop", "config.json"))
		})
	})

	describe("read()", () => {
		it("returns defaults when no file exists", () => {
			const configPath = path()
			if (existsSync(configPath)) rmSync(configPath)

			const config = read()
			expect(config.theme).toBeUndefined()
			expect(config.defaultAgent).toBe("build")
			expect(config.defaultModel).toBeNull()
			expect(config.permission.approvalPolicy).toBe("default")
			expect(config.permission.rules.bash).toBe("ask")
			expect(config.permission.rules.read).toBe("allow")
		})

		it("reads from file when it exists", () => {
			writeFileSync(
				path(),
				JSON.stringify({
					theme: "light",
					defaultAgent: "universal",
					permission: {
						approvalPolicy: "full-access",
						rules: { bash: "allow" },
					},
				}),
			)
			invalidate()

			const config = read()
			expect(config.theme).toBe("light")
			expect(config.defaultAgent).toBe("universal")
			expect(config.permission.approvalPolicy).toBe("full-access")
			expect(config.permission.rules.bash).toBe("allow")
		})

		it("returns cached value on subsequent calls", () => {
			writeFileSync(path(), JSON.stringify({ theme: "light" }))
			invalidate()

			const first = read()
			expect(first.theme).toBe("light")

			// Modify the file — should NOT be re-read (cached)
			writeFileSync(path(), JSON.stringify({ theme: "dark" }))
			const second = read()
			expect(second.theme).toBe("light")
		})

		it("returns defaults on malformed JSON", () => {
			writeFileSync(path(), "not valid json {{{")
			invalidate()

			const config = read()
			expect(config).toEqual(DEFAULT_CONFIG)
		})
	})

	describe("write()", () => {
		it("writes a new config file", () => {
			const result = write({ theme: "light" })
			expect(result.theme).toBe("light")
			expect(result.defaultAgent).toBe("build") // default preserved

			const raw = JSON.parse(readFileSync(path(), "utf-8"))
			expect(raw.theme).toBe("light")
		})

		it("deep-merges permission section", () => {
			write({ permission: { approvalPolicy: "full-access" } })
			invalidate()

			const config = read()
			expect(config.permission.approvalPolicy).toBe("full-access")
			expect(config.permission.rules.bash).toBe("ask") // default preserved
		})

		it("deep-merges permission rules", () => {
			write({ permission: { rules: { bash: "allow" } } })
			invalidate()

			const config = read()
			expect(config.permission.rules.bash).toBe("allow")
			expect(config.permission.rules.read).toBe("allow") // default preserved
			expect(config.permission.rules.edit).toBe("ask") // default preserved
		})

		it("updates the cache", () => {
			const first = read()
			expect(first.theme).toBeUndefined()

			write({ theme: "light" })
			// No invalidate — should use updated cache
			const second = read()
			expect(second.theme).toBe("light")
		})

		it("throws on invalid config", () => {
			expect(() => write({ theme: "invalid" as any })).toThrow(/Invalid config/)
		})
	})

	describe("ensure()", () => {
		it("creates config file with defaults if nothing exists", () => {
			const configPath = path()
			if (existsSync(configPath)) rmSync(configPath)
			invalidate()

			ensure()
			expect(existsSync(configPath)).toBe(true)

			const raw = JSON.parse(readFileSync(configPath, "utf-8"))
			expect(raw.defaultAgent).toBe("build")
			expect(raw.permission.approvalPolicy).toBe("default")
		})

		it("does not overwrite existing config", () => {
			writeFileSync(path(), JSON.stringify({ theme: "light" }))
			invalidate()

			ensure()

			invalidate()
			const config = read()
			expect(config.theme).toBe("light")
		})

		it("migrates from old permissions.json", () => {
			const configPath = path()
			const legacyDir = join(TEST_HOME, ".config", "loop")
			mkdirSync(legacyDir, { recursive: true })
			const oldPath = join(legacyDir, "permissions.json")

			if (existsSync(configPath)) rmSync(configPath)
			writeFileSync(
				oldPath,
				JSON.stringify({
					approvalPolicy: "full-access",
					permission: { bash: "allow", edit: "deny" },
				}),
			)
			invalidate()

			ensure()

			invalidate()
			const config = read()
			expect(config.permission.approvalPolicy).toBe("full-access")
			expect(config.permission.rules.bash).toBe("allow")
			expect(config.permission.rules.edit).toBe("deny")

			// Old file renamed to .bak
			expect(existsSync(oldPath)).toBe(false)
			expect(existsSync(`${oldPath}.bak`)).toBe(true)
		})

		it("migrates from legacy ~/.config/loop/config.json", () => {
			const configPath = path()
			if (existsSync(configPath)) rmSync(configPath)

			const legacyDir = join(TEST_HOME, ".config", "loop")
			mkdirSync(legacyDir, { recursive: true })
			const legacyConfig = join(legacyDir, "config.json")
			writeFileSync(legacyConfig, JSON.stringify({ theme: "light", defaultAgent: "universal" }))
			invalidate()

			ensure()

			invalidate()
			const config = read()
			expect(config.theme).toBe("light")
			expect(config.defaultAgent).toBe("universal")

			// Legacy file renamed to .bak
			expect(existsSync(legacyConfig)).toBe(false)
			expect(existsSync(`${legacyConfig}.bak`)).toBe(true)
		})

		it("migrates DB config values", () => {
			const configPath = path()
			if (existsSync(configPath)) rmSync(configPath)
			invalidate()

			ensure(() => ({
				theme: "light",
				defaultAgent: "universal",
				approvalPolicy: "full-access",
			}))

			invalidate()
			const config = read()
			expect(config.theme).toBe("light")
			expect(config.defaultAgent).toBe("universal")
			expect(config.permission.approvalPolicy).toBe("full-access")
		})
	})

	describe("invalidate()", () => {
		it("forces re-read from disk", () => {
			writeFileSync(path(), JSON.stringify({ theme: "light" }))
			invalidate()
			expect(read().theme).toBe("light")

			writeFileSync(path(), JSON.stringify({ theme: "dark" }))
			invalidate()
			expect(read().theme).toBe("dark")
		})
	})
})

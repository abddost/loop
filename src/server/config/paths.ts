import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

// ────────────────────────────────────────────────────────────
// Global config paths
// ────────────────────────────────────────────────────────────

/** Returns the global config directory: ~/.config/loop */
export function getGlobalConfigDir(): string {
	return join(homedir(), ".config", "loop")
}

/** Returns the full path to the global config file: ~/.config/loop/config.json */
export function getGlobalConfigPath(): string {
	return join(getGlobalConfigDir(), "config.json")
}

// ────────────────────────────────────────────────────────────
// Project config paths
// ────────────────────────────────────────────────────────────

/**
 * Walk upward from `startDir` looking for `.loop/config.json`.
 * Stops at filesystem root. Returns the first match or undefined.
 */
export function findProjectConfigPath(startDir: string): string | undefined {
	let dir = resolve(startDir)
	const root = dirname(dir) === dir ? dir : undefined // handle root edge case

	while (true) {
		const candidate = join(dir, ".loop", "config.json")
		if (existsSync(candidate)) return candidate

		const parent = dirname(dir)
		if (parent === dir || parent === root) break
		dir = parent
	}
	return undefined
}

/**
 * Returns the project config path for a given directory.
 * Looks for `.loop/config.json` walking upward from `startDir`.
 */
export function getProjectConfigPath(startDir: string): string | undefined {
	return findProjectConfigPath(startDir)
}

// ────────────────────────────────────────────────────────────
// JSONC support
// ────────────────────────────────────────────────────────────

/**
 * Strip single-line comments (// ...) from JSON text.
 * Handles strings correctly — does not strip inside quoted values.
 */
export function stripJsonComments(text: string): string {
	let result = ""
	let i = 0
	while (i < text.length) {
		// Skip strings
		if (text[i] === '"') {
			const start = i
			i++ // skip opening quote
			while (i < text.length) {
				if (text[i] === "\\") {
					i += 2 // skip escape sequence
					continue
				}
				if (text[i] === '"') {
					i++ // skip closing quote
					break
				}
				i++
			}
			result += text.slice(start, i)
			continue
		}

		// Line comments: //
		if (text[i] === "/" && text[i + 1] === "/") {
			// Skip until end of line
			while (i < text.length && text[i] !== "\n") i++
			continue
		}

		// Block comments: /* ... */
		if (text[i] === "/" && text[i + 1] === "*") {
			i += 2
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
			i += 2 // skip */
			continue
		}

		result += text[i]
		i++
	}
	return result
}

// ────────────────────────────────────────────────────────────
// Environment variable substitution
// ────────────────────────────────────────────────────────────

/**
 * Recursively substitute `{env:VAR_NAME}` tokens in string values.
 * Returns the value with env vars expanded, or empty string if not set.
 */
export function substituteEnvVars<T>(value: T): T {
	if (typeof value === "string") {
		return value.replace(/\{env:([^}]+)\}/g, (_, varName: string) => {
			return process.env[varName] ?? ""
		}) as T
	}

	if (Array.isArray(value)) {
		return value.map((item) => substituteEnvVars(item)) as T
	}

	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {}
		for (const [key, val] of Object.entries(value)) {
			result[key] = substituteEnvVars(val)
		}
		return result as T
	}

	return value
}

// ────────────────────────────────────────────────────────────
// Read config file (JSONC-aware)
// ────────────────────────────────────────────────────────────

/**
 * Read and parse a JSONC config file with env var substitution.
 * Returns undefined if the file doesn't exist.
 * Throws on parse errors.
 */
export function readConfigFile(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) return undefined

	const raw = readFileSync(filePath, "utf-8")
	const stripped = stripJsonComments(raw)

	try {
		const parsed = JSON.parse(stripped)
		return substituteEnvVars(parsed)
	} catch (err) {
		throw new Error(
			`Failed to parse config file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
		)
	}
}

import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import type { AppConfig } from "@core/schema/config"
import { AppConfigSchema, DEFAULT_CONFIG } from "@core/schema/config"
import { createLogger } from "../logger"
import {
	getGlobalConfigPath,
	getLegacyConfigDir,
	getProjectConfigPath,
	readConfigFile,
} from "./paths"

const log = createLogger("config")

// ────────────────────────────────────────────────────────────
// Paths (delegates to paths module)
// ────────────────────────────────────────────────────────────

/** Returns the full path to the global config file. */
export function path(): string {
	return getGlobalConfigPath()
}

// ────────────────────────────────────────────────────────────
// In-memory cache
// ────────────────────────────────────────────────────────────

let cached: AppConfig | null = null

/** Force the next `read()` to re-read from disk. */
export function invalidate(): void {
	cached = null
}

// ────────────────────────────────────────────────────────────
// Deep merge
// ────────────────────────────────────────────────────────────

/** Array fields that should be concatenated (deduplicated) rather than replaced. */
const CONCAT_ARRAY_KEYS = new Set(["disabled_providers", "enabled_providers", "enabledModels"])

/** Record-type fields where null entries mean "remove this entry". */
const MAP_FIELDS = new Set(["mcp", "provider", "model_visibility"])

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Keys we must never merge into a config object — they would mutate
 * `Object.prototype` if a malicious JSONC file sets them. JSON.parse
 * already drops `__proto__` during parsing but `constructor.prototype`
 * still bypasses that, so we filter explicitly.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"])

interface MergeOptions {
	/** When true, CONCAT_ARRAY_KEYS are concatenated and deduplicated. When false, source wins. */
	concatArrays: boolean
}

/**
 * Deep merge two config objects.
 * - Objects: recursive merge
 * - Arrays in CONCAT_ARRAY_KEYS: concatenate (overlay mode) or replace (write mode)
 * - Other arrays / primitives: later value wins
 * - Null values are preserved (valid for nullable schema fields like uiFont).
 *   To remove entries from map-like records (mcp, provider), set the entry to null
 *   and call {@link cleanNullMapEntries} after merge.
 */
function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
	opts: MergeOptions = { concatArrays: false },
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...target }

	for (const key of Object.keys(source)) {
		// Never allow prototype-pollution vectors to flow through the config
		// deep merge. `__proto__` is dropped by JSON.parse but `constructor`
		// / `prototype` are not, and this function is used recursively.
		if (FORBIDDEN_KEYS.has(key)) continue

		const sourceVal = source[key]
		const targetVal = result[key]

		// Undefined means "not provided" — skip
		if (sourceVal === undefined) continue

		// Null: preserve as value (nullable schema fields like uiFont, defaultModel)
		if (sourceVal === null) {
			result[key] = null
			continue
		}

		// Concatenate arrays for specific keys (only in overlay/read mode)
		if (opts.concatArrays && CONCAT_ARRAY_KEYS.has(key) && Array.isArray(sourceVal)) {
			const existing = Array.isArray(targetVal) ? targetVal : []
			result[key] = [...new Set([...existing, ...sourceVal])]
			continue
		}

		// Recursive merge for nested objects
		if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
			result[key] = deepMerge(targetVal, sourceVal, opts)
			continue
		}

		// Primitives and non-concat arrays: later value wins
		result[key] = sourceVal
	}

	return result
}

/**
 * Remove null entries from record-type fields (mcp, provider, model_visibility).
 * In these fields, setting an entry to null means "remove it".
 * Must be called after deepMerge and before Zod validation.
 */
function cleanNullMapEntries(obj: Record<string, unknown>): void {
	for (const key of MAP_FIELDS) {
		const val = obj[key]
		if (!isPlainObject(val)) continue
		for (const [k, v] of Object.entries(val)) {
			if (v === null || v === undefined) delete val[k]
		}
	}
}

// ────────────────────────────────────────────────────────────
// Read — global, project, merged
// ────────────────────────────────────────────────────────────

/**
 * Read only the global config (~/.loop/config.json).
 * Returns DEFAULT_CONFIG if the file doesn't exist or can't be parsed.
 * Supports JSONC (comments) and {env:VAR} substitution.
 */
export function readGlobal(): AppConfig {
	const filePath = getGlobalConfigPath()
	try {
		const raw = readConfigFile(filePath)
		if (!raw) return { ...DEFAULT_CONFIG }
		return AppConfigSchema.parse(raw)
	} catch (err) {
		log.warn("Failed to read global config, using defaults", { path: filePath, error: err })
		return { ...DEFAULT_CONFIG }
	}
}

/**
 * Read only the project config (.loop/config.json, walking up from `dir`).
 * Returns undefined if no project config is found.
 * Supports JSONC (comments) and {env:VAR} substitution.
 */
export function readProject(dir: string): Partial<AppConfig> | undefined {
	const filePath = getProjectConfigPath(dir)
	if (!filePath) return undefined

	try {
		const raw = readConfigFile(filePath)
		if (!raw) return undefined
		// Parse as partial — project config is an overlay, not a complete config
		return AppConfigSchema.partial().parse(raw)
	} catch (err) {
		log.warn("Failed to read project config, ignoring", { path: filePath, error: err })
		return undefined
	}
}

/**
 * Returns the merged config: global + project (project takes precedence).
 * Reads from disk on first call, then returns the in-memory cache.
 * Pass `projectDir` to enable project-level config merging.
 *
 * When called without arguments (the common case), behaves identically
 * to the original implementation — reads global config only.
 */
export function read(projectDir?: string): AppConfig {
	if (cached && !projectDir) return cached

	try {
		const globalConfig = readGlobal()

		if (!projectDir) {
			cached = globalConfig
			return cached
		}

		const projectConfig = readProject(projectDir)
		if (!projectConfig) {
			cached = globalConfig
			return cached
		}

		// Merge: global is base, project overlays on top (concat arrays)
		const merged = deepMerge(
			globalConfig as unknown as Record<string, unknown>,
			projectConfig as Record<string, unknown>,
			{ concatArrays: true },
		)
		cached = AppConfigSchema.parse(merged)
		return cached
	} catch (err) {
		log.warn("Failed to read merged config, using defaults", { error: err })
		cached = { ...DEFAULT_CONFIG }
		return cached
	}
}

// ────────────────────────────────────────────────────────────
// Write — global + project
// ────────────────────────────────────────────────────────────

/**
 * Atomically write a validated config object to a file path.
 * Creates parent directories if needed. Applies three defenses:
 *
 *   1. **Symlink refusal.** If `filePath` already exists as a symlink,
 *      refuse to write — a malicious symlink could redirect writes to
 *      `~/.ssh/authorized_keys` or similar. The user can remove the
 *      symlink manually if it's legitimate.
 *   2. **0600 permissions.** The config file contains API keys and must
 *      not be world- or group-readable. We chmod immediately after write.
 *   3. **Atomic rename.** Writing to `.tmp` then renaming gives an
 *      all-or-nothing update and avoids leaving a half-written file.
 */
function writeToFile(filePath: string, config: Record<string, unknown>): void {
	const dir = dirname(filePath)
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

	// Refuse to follow a pre-existing symlink at the target path.
	try {
		const st = lstatSync(filePath)
		if (st.isSymbolicLink()) {
			throw new Error(`Refusing to write config: ${filePath} is a symlink. Remove it and retry.`)
		}
	} catch (err) {
		// ENOENT is fine — the file simply doesn't exist yet.
		const code = (err as NodeJS.ErrnoException)?.code
		if (code && code !== "ENOENT") throw err
	}

	const tmpPath = `${filePath}.tmp`
	writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 })
	try {
		chmodSync(tmpPath, 0o600)
	} catch {
		// Best-effort on platforms where chmod is a no-op (Windows).
	}
	renameSync(tmpPath, filePath)
	try {
		chmodSync(filePath, 0o600)
	} catch {
		// Best-effort.
	}
}

/**
 * Deep-merge a partial config update into the current global config,
 * validate, write atomically to disk, and update the cache.
 */
export function write(patch: Record<string, unknown>): AppConfig {
	return writeGlobal(patch)
}

/**
 * Write to the global config file (~/.loop/config.json).
 * Merges `patch` into the current global config.
 */
export function writeGlobal(patch: Record<string, unknown>): AppConfig {
	const current = readGlobal()
	const merged = deepMerge(current as unknown as Record<string, unknown>, patch)
	cleanNullMapEntries(merged)

	const result = AppConfigSchema.safeParse(merged)
	if (!result.success) {
		const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
		throw new Error(`Invalid config: ${messages.join("; ")}`)
	}

	const validated = result.data
	const filePath = getGlobalConfigPath()

	try {
		writeToFile(filePath, validated as unknown as Record<string, unknown>)
		log.info("Global config written", { path: filePath })
	} catch (err) {
		log.error("Failed to write global config", { path: filePath, error: err })
	}

	cached = validated
	return cached
}

/**
 * Write to a project config file (.loop/config.json in `dir`).
 * Merges `patch` into the existing project config (or creates a new one).
 * Only writes the project overlay — does not include global defaults.
 */
export function writeProject(dir: string, patch: Record<string, unknown>): Partial<AppConfig> {
	const projectDir = join(dir, ".loop")
	const filePath = join(projectDir, "config.json")

	// Read existing project config if any
	const existing = readConfigFile(filePath) ?? {}
	const merged = deepMerge(existing, patch)

	// Validate the overlay as partial config
	const result = AppConfigSchema.partial().safeParse(merged)
	if (!result.success) {
		const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
		throw new Error(`Invalid project config: ${messages.join("; ")}`)
	}

	const validated = result.data

	try {
		writeToFile(filePath, validated as Record<string, unknown>)
		log.info("Project config written", { path: filePath })
	} catch (err) {
		log.error("Failed to write project config", { path: filePath, error: err })
	}

	// Invalidate the merged cache since project config changed
	invalidate()
	return validated
}

// ────────────────────────────────────────────────────────────
// Startup initialization + migration
// ────────────────────────────────────────────────────────────

/**
 * Ensure the config file exists. Migrates from old locations if found.
 * Migration priority:
 *   1. ~/.loop/config.json already exists → use it
 *   2. ~/.config/loop/config.json exists → copy to ~/.loop/config.json
 *   3. ~/.config/loop/permissions.json exists → convert and write to ~/.loop/config.json
 *   4. Nothing exists → create fresh ~/.loop/config.json
 *
 * Called once at server startup.
 */
export function ensure(migrateDbConfig?: () => Record<string, unknown> | undefined): void {
	const configPath = getGlobalConfigPath()

	if (existsSync(configPath)) {
		// Config file already exists at new location — just migrate DB values if any
		if (migrateDbConfig) {
			migrateFromDb(migrateDbConfig)
		}
		return
	}

	// Try to migrate from old config location: ~/.config/loop/config.json
	const legacyDir = getLegacyConfigDir()
	const legacyConfigPath = join(legacyDir, "config.json")

	if (existsSync(legacyConfigPath)) {
		try {
			const raw = readFileSync(legacyConfigPath, "utf-8")
			const parsed = JSON.parse(raw) as Record<string, unknown>

			// Write to new location
			write(parsed)
			log.info("Migrated config from ~/.config/loop/ to ~/.loop/", {
				from: legacyConfigPath,
				to: configPath,
			})

			// Rename old file to .bak (don't delete, be safe)
			renameSync(legacyConfigPath, `${legacyConfigPath}.bak`)
		} catch (err) {
			log.warn("Failed to migrate legacy config, creating fresh", { error: err })
			write({})
		}
	} else {
		// Try to migrate from old permissions.json (even older format)
		const oldPermissionsPath = join(legacyDir, "permissions.json")
		if (existsSync(oldPermissionsPath)) {
			try {
				const raw = readFileSync(oldPermissionsPath, "utf-8")
				const old = JSON.parse(raw) as {
					approvalPolicy?: string
					permission?: Record<string, unknown>
				}

				const migrated: Record<string, unknown> = {
					permission: {
						approvalPolicy: old.approvalPolicy ?? "default",
						rules: old.permission ?? {},
					},
				}

				write(migrated)
				log.info("Migrated permissions.json to config.json", { path: configPath })

				// Rename old file to .bak (don't delete, be safe)
				renameSync(oldPermissionsPath, `${oldPermissionsPath}.bak`)
			} catch (err) {
				log.warn("Failed to migrate permissions.json, creating fresh config", { error: err })
				write({})
			}
		} else {
			// No old file, no new file — create fresh
			write({})
		}
	}

	// Migrate DB config values if callback provided
	if (migrateDbConfig) {
		migrateFromDb(migrateDbConfig)
	}
}

/**
 * Migrate app config values from the DB config table to the file.
 * The callback returns a record of key->value pairs from the DB,
 * and a cleanup function is not needed — caller handles deletion.
 */
function migrateFromDb(getDbValues: () => Record<string, unknown> | undefined): void {
	try {
		const stored = getDbValues()
		if (!stored) return

		const appKeys = ["theme", "defaultAgent", "defaultModel", "approvalPolicy"]
		const patch: Record<string, unknown> = {}
		let hasValues = false

		for (const key of appKeys) {
			if (key in stored) {
				if (key === "approvalPolicy") {
					// Move approvalPolicy into permission.approvalPolicy
					patch.permission = {
						...(patch.permission as Record<string, unknown>),
						approvalPolicy: stored[key],
					}
				} else {
					patch[key] = stored[key]
				}
				hasValues = true
			}
		}

		if (hasValues) {
			write(patch)
			log.info("Migrated DB config to file", { keys: Object.keys(patch) })
		}
	} catch (err) {
		log.warn("Failed to migrate DB config", { error: err })
	}
}

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { AppConfig } from "@core/schema/config"
import { AppConfigSchema, DEFAULT_CONFIG } from "@core/schema/config"
import { createLogger } from "../logger"

const log = createLogger("config")

// ────────────────────────────────────────────────────────────
// Paths
// ────────────────────────────────────────────────────────────

function getConfigDir(): string {
	return join(homedir(), ".config", "loop")
}

function getConfigPath(): string {
	return join(getConfigDir(), "config.json")
}

/** Returns the full path to the config file. */
export function path(): string {
	return getConfigPath()
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
// Read
// ────────────────────────────────────────────────────────────

/**
 * Returns the current config. Reads from disk on first call,
 * then returns the in-memory cache.
 */
export function read(): AppConfig {
	if (cached) return cached

	const filePath = getConfigPath()
	try {
		if (!existsSync(filePath)) {
			cached = { ...DEFAULT_CONFIG }
			return cached
		}
		const raw = readFileSync(filePath, "utf-8")
		const parsed = JSON.parse(raw)
		cached = AppConfigSchema.parse(parsed)
		return cached
	} catch (err) {
		log.warn("Failed to read config, using defaults", { path: filePath, error: err })
		cached = { ...DEFAULT_CONFIG }
		return cached
	}
}

// ────────────────────────────────────────────────────────────
// Write
// ────────────────────────────────────────────────────────────

/**
 * Deep-merge a partial config update into the current config,
 * validate, write atomically to disk, and update the cache.
 */
export function write(patch: Record<string, unknown>): AppConfig {
	const current = read()

	// Deep merge: handle nested permission object
	const permissionPatch = patch.permission as Record<string, unknown> | undefined
	const merged = {
		...current,
		...patch,
		permission: permissionPatch
			? {
					...current.permission,
					...permissionPatch,
					rules:
						permissionPatch.rules != null
							? {
									...current.permission.rules,
									...(permissionPatch.rules as Record<string, unknown>),
								}
							: current.permission.rules,
				}
			: current.permission,
	}

	const result = AppConfigSchema.safeParse(merged)
	if (!result.success) {
		const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
		throw new Error(`Invalid config: ${messages.join("; ")}`)
	}

	const validated = result.data
	const filePath = getConfigPath()

	try {
		const dir = dirname(filePath)
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

		// Atomic write: write to temp, then rename
		const tmpPath = `${filePath}.tmp`
		writeFileSync(tmpPath, `${JSON.stringify(validated, null, 2)}\n`, "utf-8")
		renameSync(tmpPath, filePath)

		log.info("Config written", { path: filePath })
	} catch (err) {
		log.error("Failed to write config", { path: filePath, error: err })
	}

	cached = validated
	return cached
}

// ────────────────────────────────────────────────────────────
// Startup initialization + migration
// ────────────────────────────────────────────────────────────

/**
 * Ensure the config file exists. Migrates from old `permissions.json`
 * and DB config values if found. Called once at server startup.
 */
export function ensure(migrateDbConfig?: () => Record<string, unknown> | undefined): void {
	const configPath = getConfigPath()

	if (existsSync(configPath)) {
		// Config file already exists — just migrate DB values if any
		if (migrateDbConfig) {
			migrateFromDb(migrateDbConfig)
		}
		return
	}

	// Try to migrate from old permissions.json
	const oldPermissionsPath = join(getConfigDir(), "permissions.json")
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

	// Migrate DB config values if callback provided
	if (migrateDbConfig) {
		migrateFromDb(migrateDbConfig)
	}
}

/**
 * Migrate app config values from the DB config table to the file.
 * The callback returns a record of key→value pairs from the DB,
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

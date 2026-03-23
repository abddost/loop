import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { AppConfigSchema } from "@core/schema/config"
import { Hono } from "hono"
import * as Config from "../config"
import { Workspace } from "../workspace"

export const configRoutes = new Hono()

// ─── Merged Config (existing, backward compatible) ──────────────

/** GET /config - Returns the full merged configuration. */
configRoutes.get("/config", (c) => {
	return c.json(Config.read())
})

/** PATCH /config - Update configuration values. Body: partial AppConfig. */
configRoutes.patch("/config", async (c) => {
	const body = await c.req.json<Record<string, unknown>>()

	try {
		const updated = Config.write(body)
		return c.json(updated)
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return c.json({ error: message }, 400)
	}
})

/** GET /config/path - Returns the config file path. */
configRoutes.get("/config/path", (c) => {
	return c.json({ path: Config.path() })
})

// ─── Global Config ──────────────────────────────────────────────

/** GET /config/global - Returns the global config only (from ~/.config/loop/config.json). */
configRoutes.get("/config/global", (c) => {
	return c.json(Config.read())
})

/** PATCH /config/global - Update global configuration values. */
configRoutes.patch("/config/global", async (c) => {
	const body = await c.req.json<Record<string, unknown>>()

	try {
		const updated = Config.write(body)
		return c.json(updated)
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return c.json({ error: message }, 400)
	}
})

// ─── Project Config ─────────────────────────────────────────────

const PROJECT_CONFIG_NAME = ".loop/config.json"

/**
 * Resolve the project config file path from the workspace directory.
 * Returns undefined if no workspace context is available.
 */
function resolveProjectConfigPath(): string | undefined {
	try {
		const dir = Workspace.dir()
		return join(dir, PROJECT_CONFIG_NAME)
	} catch {
		return undefined
	}
}

/**
 * Read the project-level config file.
 * Returns an empty object if no project config exists.
 */
function readProjectConfig(configPath: string): Record<string, unknown> {
	try {
		if (!existsSync(configPath)) return {}
		const raw = readFileSync(configPath, "utf-8")
		return JSON.parse(raw) as Record<string, unknown>
	} catch {
		return {}
	}
}

/** GET /config/project - Get the project-level config. Requires workspace context. */
configRoutes.get("/config/project", (c) => {
	const configPath = resolveProjectConfigPath()
	if (!configPath) {
		return c.json({ error: "No workspace context. Send x-workspace-directory header." }, 400)
	}

	return c.json(readProjectConfig(configPath))
})

/** PATCH /config/project - Update the project-level config. Requires workspace context. */
configRoutes.patch("/config/project", async (c) => {
	const configPath = resolveProjectConfigPath()
	if (!configPath) {
		return c.json({ error: "No workspace context. Send x-workspace-directory header." }, 400)
	}

	const body = await c.req.json<Record<string, unknown>>()

	try {
		// Read existing project config
		const current = readProjectConfig(configPath)

		// Deep merge the patch
		const merged = { ...current, ...body }

		// Validate the merged config (project config uses the same schema)
		const validated = AppConfigSchema.partial().safeParse(merged)
		if (!validated.success) {
			const messages = validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
			return c.json({ error: `Invalid config: ${messages.join("; ")}` }, 400)
		}

		// Atomic write
		const dir = dirname(configPath)
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true })
		}
		const tmpPath = `${configPath}.tmp`
		writeFileSync(tmpPath, `${JSON.stringify(validated.data, null, 2)}\n`, "utf-8")
		renameSync(tmpPath, configPath)

		return c.json(validated.data)
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return c.json({ error: message }, 400)
	}
})

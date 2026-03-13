import { AppConfigSchema, DEFAULT_CONFIG } from "@core/schema/config"
import { Hono } from "hono"
import * as queries from "../db/queries"

export const configRoutes = new Hono()

/** Build the full config by merging DB values over defaults. */
function resolveConfig() {
	const stored = queries.getAllConfig()
	return AppConfigSchema.parse({ ...DEFAULT_CONFIG, ...stored })
}

/** GET /config - Returns the full merged configuration. */
configRoutes.get("/config", (c) => {
	return c.json(resolveConfig())
})

/** PATCH /config - Update configuration values. Body: partial AppConfig. */
configRoutes.patch("/config", async (c) => {
	const body = await c.req.json<Record<string, unknown>>()

	// Validate: reject unknown keys
	const knownKeys = new Set(Object.keys(DEFAULT_CONFIG))
	const unknownKeys = Object.keys(body).filter((k) => !knownKeys.has(k))
	if (unknownKeys.length > 0) {
		return c.json({ error: `Unknown config keys: ${unknownKeys.join(", ")}` }, 400)
	}

	// Validate values against schema (parse a full config with the patch applied)
	const current = queries.getAllConfig()
	const merged = { ...DEFAULT_CONFIG, ...current, ...body }
	const result = AppConfigSchema.safeParse(merged)
	if (!result.success) {
		const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
		return c.json({ error: `Invalid config: ${messages.join("; ")}` }, 400)
	}

	// Persist each changed key
	for (const key of Object.keys(body)) {
		queries.setConfigValue(key, JSON.stringify(body[key]))
	}

	return c.json(resolveConfig())
})

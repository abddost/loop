import { Hono } from "hono"
import * as Config from "../config"

export const configRoutes = new Hono()

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

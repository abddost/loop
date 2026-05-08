import { Hono } from "hono"
import { z } from "zod"
import * as Config from "../config"
import { createLogger } from "../logger"
import { OpenCodeRegistry } from "../provider/opencode"

const log = createLogger("opencode-routes")

export const openCodeRoutes = new Hono()

/**
 * GET /providers/opencode/status — Detection result for OpenCode.
 *
 * Returns whether the CLI is installed (or a remote server is configured),
 * whether we successfully connected, the resolved binary path/version, and
 * the discovered upstream providers and models.
 */
openCodeRoutes.get("/providers/opencode/status", async (c) => {
	const detection = await OpenCodeRegistry.getDetection()
	const settings = Config.read().opencode
	return c.json({ ...detection, enabled: settings.enabled })
})

/**
 * POST /providers/opencode/rescan — Force a fresh detection pass.
 * Call this after the user installs the CLI, edits server settings, or
 * runs `opencode auth login` to pick up new upstream providers.
 */
openCodeRoutes.post("/providers/opencode/rescan", async (c) => {
	log.info("Rescanning OpenCode")
	const detection = await OpenCodeRegistry.rescan()
	const settings = Config.read().opencode
	return c.json({ ...detection, enabled: settings.enabled })
})

/** Body shape accepted by `PATCH /providers/opencode/settings`. */
const SettingsPatchSchema = z
	.object({
		enabled: z.boolean().optional(),
		binaryPath: z.string().optional(),
		serverUrl: z.string().optional(),
		serverPassword: z.string().optional(),
	})
	.strict()

/**
 * PATCH /providers/opencode/settings — Update OpenCode connection settings.
 *
 * Persists to the global config (`~/.loop/config.json`), then triggers a
 * rescan so the picker reflects the new state immediately.
 */
openCodeRoutes.patch("/providers/opencode/settings", async (c) => {
	const body = await c.req.json<unknown>()
	const parsed = SettingsPatchSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({ error: parsed.error.message }, 400)
	}
	try {
		Config.write({ opencode: parsed.data })
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return c.json({ error: message }, 400)
	}
	const detection = await OpenCodeRegistry.rescan()
	const settings = Config.read().opencode
	return c.json({ ...detection, enabled: settings.enabled })
})

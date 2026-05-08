import { Hono } from "hono"
import { z } from "zod"
import * as Config from "../config"
import { createLogger } from "../logger"
import { ClaudeCodeRegistry } from "../provider/claude-code"

const log = createLogger("claude-code-routes")

export const claudeCodeRoutes = new Hono()

/**
 * GET /providers/claude-code/status — Detection result for the CLI.
 *
 * Returns whether the `claude` binary is installed, whether the user is
 * authenticated, the resolved binary path, version, and (if available)
 * account email/subscription type read from `~/.claude.json`. The current
 * `enabled` flag is appended so the UI toggle renders correctly.
 */
claudeCodeRoutes.get("/providers/claude-code/status", async (c) => {
	const detection = await ClaudeCodeRegistry.getDetection()
	const settings = Config.read().claudeCode
	return c.json({ ...detection, enabled: settings.enabled })
})

/**
 * POST /providers/claude-code/rescan — Force a fresh detection pass.
 * Call this after the user installs the CLI or runs `claude login`.
 */
claudeCodeRoutes.post("/providers/claude-code/rescan", async (c) => {
	log.info("Rescanning Claude Code CLI")
	const detection = await ClaudeCodeRegistry.rescan()
	const settings = Config.read().claudeCode
	return c.json({ ...detection, enabled: settings.enabled })
})

/**
 * PATCH /providers/claude-code/settings — Toggle the master enable flag.
 *
 * Disabling hides Claude Code from the model picker even when the CLI is
 * installed and authenticated; the settings card stays visible so the user
 * can re-enable. Re-rescans after writing so the response reflects fresh
 * state in one round-trip.
 */
const ClaudeCodeSettingsPatch = z.object({ enabled: z.boolean().optional() }).strict()
claudeCodeRoutes.patch("/providers/claude-code/settings", async (c) => {
	const body = await c.req.json<unknown>()
	const parsed = ClaudeCodeSettingsPatch.safeParse(body)
	if (!parsed.success) return c.json({ error: parsed.error.message }, 400)
	try {
		Config.write({ claudeCode: parsed.data })
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return c.json({ error: message }, 400)
	}
	const detection = await ClaudeCodeRegistry.getDetection()
	const settings = Config.read().claudeCode
	return c.json({ ...detection, enabled: settings.enabled })
})

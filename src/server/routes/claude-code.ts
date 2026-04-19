import { Hono } from "hono"
import { createLogger } from "../logger"
import { ClaudeCodeRegistry } from "../provider/claude-code"

const log = createLogger("claude-code-routes")

export const claudeCodeRoutes = new Hono()

/**
 * GET /providers/claude-code/status — Detection result for the CLI.
 *
 * Returns whether the `claude` binary is installed, whether the user is
 * authenticated, the resolved binary path, version, and (if available)
 * account email/subscription type read from `~/.claude.json`.
 */
claudeCodeRoutes.get("/providers/claude-code/status", async (c) => {
	const detection = await ClaudeCodeRegistry.getDetection()
	return c.json(detection)
})

/**
 * POST /providers/claude-code/rescan — Force a fresh detection pass.
 * Call this after the user installs the CLI or runs `claude login`.
 */
claudeCodeRoutes.post("/providers/claude-code/rescan", async (c) => {
	log.info("Rescanning Claude Code CLI")
	const detection = await ClaudeCodeRegistry.rescan()
	return c.json(detection)
})

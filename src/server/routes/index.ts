import { Hono } from "hono"
import { authRoutes } from "./auth"
import { claudeCodeRoutes } from "./claude-code"
import { configRoutes } from "./config"
import { editorRoutes } from "./editor"
import { eventRoutes } from "./events"
import { fileRoutes } from "./files"
import { healthRoutes } from "./health"
import { mcpRoutes } from "./mcp"
import { messageRoutes } from "./message"
import { openCodeRoutes } from "./opencode"
import { permissionRoutes } from "./permission"
import { projectRoutes } from "./project"
import { providerRoutes } from "./provider"
import { questionRoutes } from "./question"
import { sessionRoutes } from "./session"
import { skillRoutes } from "./skill"
import { terminalRoutes } from "./terminal"
import { vcsRoutes } from "./vcs"
import { worktreeRoutes } from "./worktree"

/** Aggregate all route groups into a single Hono app. */
export const allRoutes = new Hono()
	.route("/", healthRoutes)
	.route("/", authRoutes)
	.route("/", configRoutes)
	.route("/", projectRoutes)
	.route("/", sessionRoutes)
	.route("/", messageRoutes)
	.route("/", eventRoutes)
	.route("/", providerRoutes)
	.route("/", claudeCodeRoutes)
	.route("/", openCodeRoutes)
	.route("/", permissionRoutes)
	.route("/", questionRoutes)
	.route("/", vcsRoutes)
	.route("/", worktreeRoutes)
	.route("/", fileRoutes)
	.route("/", editorRoutes)
	.route("/", mcpRoutes)
	.route("/", skillRoutes)
	.route("/", terminalRoutes)

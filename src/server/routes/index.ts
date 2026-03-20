import { Hono } from "hono"
import { configRoutes } from "./config"
import { editorRoutes } from "./editor"
import { eventRoutes } from "./events"
import { healthRoutes } from "./health"
import { mcpRoutes } from "./mcp"
import { messageRoutes } from "./message"
import { permissionRoutes } from "./permission"
import { projectRoutes } from "./project"
import { providerRoutes } from "./provider"
import { questionRoutes } from "./question"
import { sessionRoutes } from "./session"
import { skillRoutes } from "./skill"
import { terminalRoutes } from "./terminal"
import { vcsRoutes } from "./vcs"

/** Aggregate all route groups into a single Hono app. */
export const allRoutes = new Hono()
	.route("/", healthRoutes)
	.route("/", configRoutes)
	.route("/", projectRoutes)
	.route("/", sessionRoutes)
	.route("/", messageRoutes)
	.route("/", eventRoutes)
	.route("/", providerRoutes)
	.route("/", permissionRoutes)
	.route("/", questionRoutes)
	.route("/", vcsRoutes)
	.route("/", editorRoutes)
	.route("/", mcpRoutes)
	.route("/", skillRoutes)
	.route("/", terminalRoutes)

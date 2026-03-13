import { Hono } from "hono"
import { configRoutes } from "./config"
import { eventRoutes } from "./events"
import { healthRoutes } from "./health"
import { messageRoutes } from "./message"
import { permissionRoutes } from "./permission"
import { projectRoutes } from "./project"
import { providerRoutes } from "./provider"
import { questionRoutes } from "./question"
import { sessionRoutes } from "./session"
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

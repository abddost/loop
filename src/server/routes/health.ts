import { Hono } from "hono"

export const healthRoutes = new Hono()

/** GET /health - Returns server health status, version, and uptime. */
healthRoutes.get("/health", (c) => {
	return c.json({ status: "ok", version: "0.1.0", uptime: process.uptime() })
})

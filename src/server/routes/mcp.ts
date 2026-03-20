import { McpServerConfigSchema } from "@core/schema/mcp"
import { Hono } from "hono"
import * as MCP from "../mcp"
import { requireWorkspace } from "./require-workspace"

export const mcpRoutes = new Hono()

/** GET /mcp/servers — list all MCP servers with status. */
mcpRoutes.get("/mcp/servers", (c) => {
	requireWorkspace()
	return c.json(MCP.status())
})

/** POST /mcp/servers — add a new MCP server. */
mcpRoutes.post("/mcp/servers", async (c) => {
	requireWorkspace()
	const body = await c.req.json<{ name: string; config: unknown }>()

	if (!body.name || typeof body.name !== "string") {
		return c.json({ error: "name is required" }, 400)
	}

	const parsed = McpServerConfigSchema.safeParse(body.config)
	if (!parsed.success) {
		const messages = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
		return c.json({ error: `Invalid config: ${messages.join("; ")}` }, 400)
	}

	try {
		await MCP.add(body.name, parsed.data)
		return c.json(MCP.status(), 201)
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return c.json({ error: message }, 500)
	}
})

/** DELETE /mcp/servers/:name — remove an MCP server. */
mcpRoutes.delete("/mcp/servers/:name", async (c) => {
	requireWorkspace()
	const name = decodeURIComponent(c.req.param("name"))

	try {
		await MCP.remove(name)
		return c.json({ ok: true })
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return c.json({ error: message }, 400)
	}
})

/** POST /mcp/servers/:name/connect — connect a server. */
mcpRoutes.post("/mcp/servers/:name/connect", async (c) => {
	requireWorkspace()
	const name = decodeURIComponent(c.req.param("name"))

	try {
		await MCP.connect(name)
		return c.json(MCP.status())
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return c.json({ error: message }, 400)
	}
})

/** POST /mcp/servers/:name/disconnect — disconnect a server. */
mcpRoutes.post("/mcp/servers/:name/disconnect", async (c) => {
	requireWorkspace()
	const name = decodeURIComponent(c.req.param("name"))

	try {
		await MCP.disconnect(name)
		return c.json(MCP.status())
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return c.json({ error: message }, 400)
	}
})

/** POST /mcp/servers/:name/restart — restart a server. */
mcpRoutes.post("/mcp/servers/:name/restart", async (c) => {
	requireWorkspace()
	const name = decodeURIComponent(c.req.param("name"))

	try {
		await MCP.restart(name)
		return c.json(MCP.status())
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return c.json({ error: message }, 400)
	}
})

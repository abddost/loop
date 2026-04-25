import { Hono } from "hono"
import * as Editor from "../editor"
import { requireWorkspace } from "./require-workspace"

export const editorRoutes = new Hono()

/** GET /editors — list detected editors. */
editorRoutes.get("/editors", (c) => {
	return c.json(Editor.detectEditors())
})

/** POST /editor/open — open a file or directory in an editor. */
editorRoutes.post("/editor/open", async (c) => {
	const { directory: cwd } = requireWorkspace()
	const body = await c.req.json<{
		editorId: string
		path?: string
		line?: number
		directory?: boolean
	}>()

	if (!body.editorId || typeof body.editorId !== "string") {
		return c.json({ error: "editorId is required" }, 400)
	}

	try {
		if (body.directory) {
			Editor.openDirectory(body.editorId, cwd)
		} else if (body.path && typeof body.path === "string") {
			const line = typeof body.line === "number" && body.line > 0 ? body.line : undefined
			Editor.openFile(body.editorId, body.path, cwd, line)
		} else {
			return c.json({ error: "path or directory flag is required" }, 400)
		}
		return c.json({ ok: true })
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return c.json({ error: message }, 400)
	}
})

/** POST /editors/refresh — re-detect editors (used when the dropdown is opened). */
editorRoutes.post("/editors/refresh", (c) => {
	return c.json(Editor.detectEditors())
})

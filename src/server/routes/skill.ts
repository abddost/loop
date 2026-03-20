import { Hono } from "hono"
import { discover } from "../skill"
import { requireWorkspace } from "./require-workspace"

export const skillRoutes = new Hono()

/** GET /skills — list all available skills. */
skillRoutes.get("/skills", (c) => {
	requireWorkspace()
	return c.json(discover())
})

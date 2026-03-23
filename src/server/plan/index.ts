import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Workspace } from "../workspace"

/** Get the plans directory path for the current workspace */
export function plansDir(): string {
	return resolve(Workspace.dir(), ".loop", "plans")
}

/** Get the full path for a plan file by session ID */
export function planPath(sessionId: string): string {
	return join(plansDir(), `${sessionId}.md`)
}

/** Read a plan file. Returns undefined if not found. */
export function readPlan(sessionId: string): string | undefined {
	const path = planPath(sessionId)
	if (!existsSync(path)) return undefined
	try {
		return readFileSync(path, "utf-8")
	} catch {
		return undefined
	}
}

/** Write plan content to the plan file. Creates directory if needed. Returns the file path. */
export function writePlan(sessionId: string, content: string): string {
	const dir = plansDir()
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
	const path = planPath(sessionId)
	writeFileSync(path, content, "utf-8")
	return path
}

/** List all plan files in the workspace. Returns array of { sessionId, path }. */
export function listPlans(): Array<{ sessionId: string; path: string }> {
	const dir = plansDir()
	if (!existsSync(dir)) return []
	try {
		return readdirSync(dir)
			.filter((f) => f.endsWith(".md"))
			.map((f) => ({
				sessionId: f.replace(/\.md$/, ""),
				path: join(dir, f),
			}))
	} catch {
		return []
	}
}

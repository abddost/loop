import { Hono } from "hono"
import { type TerminalInfo, terminalManager } from "../terminal/manager"
import { Workspace } from "../workspace"
import { upgradeWebSocket } from "../ws"
import { requireWorkspace } from "./require-workspace"

export const terminalRoutes = new Hono()

/** List all terminals in the current workspace */
terminalRoutes.get("/terminals", (c) => {
	requireWorkspace()
	return c.json(terminalManager().list())
})

/** Create a new terminal */
terminalRoutes.post("/terminals", async (c) => {
	requireWorkspace()
	const body = await c.req
		.json<{ cols?: number; rows?: number }>()
		.catch((): { cols?: number; rows?: number } => ({}))
	const terminal = terminalManager().create(body.cols, body.rows)
	const info: TerminalInfo = {
		id: terminal.id,
		title: terminal.title,
		shell: terminal.shell,
		cwd: terminal.cwd,
	}
	return c.json(info, 201)
})

/** Resize a terminal */
terminalRoutes.post("/terminals/:id/resize", async (c) => {
	requireWorkspace()
	const id = c.req.param("id")
	const { cols, rows } = await c.req.json<{ cols: number; rows: number }>()
	const ok = terminalManager().resize(id, cols, rows)
	if (!ok) return c.json({ error: "Terminal not found" }, 404)
	return c.body(null, 204)
})

/** Close a terminal */
terminalRoutes.delete("/terminals/:id", (c) => {
	requireWorkspace()
	const id = c.req.param("id")
	const ok = terminalManager().close(id)
	if (!ok) return c.json({ error: "Terminal not found" }, 404)
	return c.body(null, 204)
})

/**
 * WebSocket endpoint for terminal I/O.
 * Auth via `token` query param (WebSocket can't send custom headers).
 * Workspace via `directory` query param.
 *
 * The workspace context is captured during the HTTP upgrade phase.
 * PTY data flows directly through the WebSocket after upgrade.
 */
terminalRoutes.get(
	"/terminals/:id/ws",
	upgradeWebSocket((c) => {
		const termId = c.req.param("id")
		const dir = c.req.header("x-workspace-directory") || c.req.query("directory")

		// Resolve workspace and terminal during upgrade (within middleware context)
		let terminal: ReturnType<ReturnType<typeof terminalManager>["get"]>

		if (dir) {
			const wsCtx = Workspace.get(dir)
			if (wsCtx && termId) {
				terminal = Workspace.run(wsCtx, () => terminalManager().get(termId))
			}
		} else if (termId) {
			// If middleware already set up workspace context (header was present)
			try {
				terminal = terminalManager().get(termId)
			} catch {
				// Not in workspace context
			}
		}

		let dataDisposable: { dispose(): void } | undefined

		return {
			onOpen(_evt, ws) {
				if (!terminal) {
					ws.close(1008, "Terminal not found")
					return
				}

				// PTY → WebSocket
				dataDisposable = terminal.pty.onData((data) => {
					try {
						ws.send(data)
					} catch {
						// WebSocket may be closing
					}
				})

				// Handle PTY exit
				terminal.pty.onExit(({ exitCode }) => {
					try {
						ws.send(`\r\n[Process exited with code ${exitCode}]\r\n`)
						ws.close(1000, "Process exited")
					} catch {
						// Already closed
					}
				})
			},
			onMessage(evt) {
				if (!terminal) return
				const data = evt.data
				if (typeof data === "string") {
					terminal.pty.write(data)
				} else if (data instanceof ArrayBuffer) {
					terminal.pty.write(new Uint8Array(data) as any)
				}
			},
			onClose() {
				dataDisposable?.dispose()
			},
		}
	}),
)

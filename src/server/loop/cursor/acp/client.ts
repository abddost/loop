import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { createLogger } from "../../../logger"
import { ACP_METHODS } from "./types"
import type {
	AuthenticateRequest,
	AuthenticateResponse,
	CancelNotification,
	CreateTerminalRequest,
	CreateTerminalResponse,
	InitializeRequest,
	InitializeResponse,
	JsonRpcMessage,
	JsonRpcNotification,
	JsonRpcRequest,
	LoadSessionRequest,
	LoadSessionResponse,
	NewSessionRequest,
	NewSessionResponse,
	PromptRequest,
	PromptResponse,
	ReadTextFileRequest,
	ReadTextFileResponse,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionNotification,
	SetSessionConfigOptionRequest,
	SetSessionConfigOptionResponse,
	SetSessionModeRequest,
	SetSessionModeResponse,
	TerminalKillRequest,
	TerminalKillResponse,
	TerminalOutputRequest,
	TerminalOutputResponse,
	TerminalReleaseRequest,
	TerminalReleaseResponse,
	TerminalWaitForExitRequest,
	TerminalWaitForExitResponse,
	WriteTextFileRequest,
	WriteTextFileResponse,
} from "./types"

/**
 * ACP client over stdio + NDJSON-framed JSON-RPC 2.0.
 *
 * Usage:
 *   const client = new AcpClient({ command: "agent", args: ["acp"], cwd, env })
 *   await client.start()
 *   await client.initialize({...})
 *   await client.authenticate({ methodId: "cursor_login" })
 *   const { sessionId } = await client.newSession({ cwd, mcpServers: [] })
 *   client.onSessionUpdate((notif) => ...)
 *   client.onRequestPermission((req) => Promise.resolve({ outcome: ... }))
 *   const res = await client.prompt({ sessionId, prompt: [{type: "text", text}] })
 *   await client.dispose()
 */

const log = createLogger("cursor-acp-client")

export class AcpProtocolError extends Error {
	readonly code: number
	readonly data: unknown
	constructor(code: number, message: string, data?: unknown) {
		super(message)
		this.name = "AcpProtocolError"
		this.code = code
		this.data = data
	}
}

export class AcpTransportError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "AcpTransportError"
	}
}

export interface AcpClientOptions {
	command: string
	args: ReadonlyArray<string>
	cwd?: string
	env?: NodeJS.ProcessEnv
	/** Log every wire message at debug level (disabled by default — verbose). */
	logWire?: boolean
}

export type RequestPermissionHandler = (
	req: RequestPermissionRequest,
) => Promise<RequestPermissionResponse>
export type ReadTextFileHandler = (req: ReadTextFileRequest) => Promise<ReadTextFileResponse>
export type WriteTextFileHandler = (req: WriteTextFileRequest) => Promise<WriteTextFileResponse>
export type CreateTerminalHandler = (req: CreateTerminalRequest) => Promise<CreateTerminalResponse>
export type TerminalOutputHandler = (req: TerminalOutputRequest) => Promise<TerminalOutputResponse>
export type TerminalKillHandler = (req: TerminalKillRequest) => Promise<TerminalKillResponse>
export type TerminalReleaseHandler = (
	req: TerminalReleaseRequest,
) => Promise<TerminalReleaseResponse>
export type TerminalWaitForExitHandler = (
	req: TerminalWaitForExitRequest,
) => Promise<TerminalWaitForExitResponse>

/** Handler for an unknown ACP extension request (e.g. `cursor/create_plan`). */
export type ExtensionRequestHandler = (params: unknown) => Promise<unknown>

interface PendingResponse {
	method: string
	resolve: (value: unknown) => void
	reject: (err: Error) => void
}

export class AcpClient {
	private readonly options: AcpClientOptions
	private child: ChildProcessWithoutNullStreams | undefined
	private nextId = 1
	private readonly pending = new Map<number, PendingResponse>()
	private terminationError: Error | undefined
	private exitWaiters: Array<(err: Error) => void> = []
	private disposed = false
	private sessionUpdateHandler: ((notif: SessionNotification) => void) | undefined
	private requestPermissionHandler: RequestPermissionHandler | undefined
	private readTextFileHandler: ReadTextFileHandler | undefined
	private writeTextFileHandler: WriteTextFileHandler | undefined
	private createTerminalHandler: CreateTerminalHandler | undefined
	private terminalOutputHandler: TerminalOutputHandler | undefined
	private terminalKillHandler: TerminalKillHandler | undefined
	private terminalReleaseHandler: TerminalReleaseHandler | undefined
	private terminalWaitForExitHandler: TerminalWaitForExitHandler | undefined
	private readonly extensionHandlers = new Map<string, ExtensionRequestHandler>()

	constructor(options: AcpClientOptions) {
		this.options = options
	}

	/** Spawn the agent subprocess and start consuming its stdout. */
	async start(): Promise<void> {
		if (this.child) throw new Error("AcpClient already started")
		try {
			this.child = spawn(this.options.command, [...this.options.args], {
				cwd: this.options.cwd,
				env: this.options.env ?? process.env,
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			}) as ChildProcessWithoutNullStreams
		} catch (err) {
			throw new AcpTransportError(
				`Failed to spawn ACP agent: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		this.child.on("error", (err) => {
			log.warn("ACP child process emitted error", { error: err.message })
			this.terminate(new AcpTransportError(`ACP child process error: ${err.message}`))
		})

		this.child.on("exit", (code, signal) => {
			const reason =
				code !== null
					? `exited with code ${code}`
					: signal
						? `terminated by signal ${signal}`
						: "exited"
			this.terminate(new AcpTransportError(`ACP agent ${reason}`))
		})

		// stderr is informational — drain it but don't reject on output
		this.child.stderr.setEncoding("utf8")
		this.child.stderr.on("data", (chunk: string) => {
			if (!chunk.trim()) return
			log.debug("ACP agent stderr", { line: chunk.trim() })
		})

		// stdout: split on newlines, decode each line as one JSON-RPC message
		this.child.stdout.setEncoding("utf8")
		const rl = createInterface({ input: this.child.stdout })
		rl.on("line", (line) => {
			if (!line.trim()) return
			this.handleIncomingLine(line)
		})
	}

	/** Tear down the subprocess. Idempotent. */
	async dispose(): Promise<void> {
		if (this.disposed) return
		this.disposed = true
		const child = this.child
		if (!child) return
		try {
			if (!child.stdin.destroyed) child.stdin.end()
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGTERM")
				// give it a brief moment to exit; then SIGKILL
				await new Promise<void>((resolve) => {
					const t = setTimeout(() => {
						if (child.exitCode === null && child.signalCode === null) {
							try {
								child.kill("SIGKILL")
							} catch {
								// already gone
							}
						}
						resolve()
					}, 1500)
					child.once("exit", () => {
						clearTimeout(t)
						resolve()
					})
				})
			}
		} catch (err) {
			log.warn("ACP dispose threw", {
				error: err instanceof Error ? err.message : String(err),
			})
		}
		this.terminate(new AcpTransportError("ACP client disposed"))
	}

	/** Resolve when the agent process exits or terminates. */
	waitForExit(): Promise<Error> {
		if (this.terminationError) return Promise.resolve(this.terminationError)
		return new Promise((resolve) => {
			this.exitWaiters.push(resolve)
		})
	}

	// ─── Outgoing typed methods ──────────────────────────────────────

	initialize(req: InitializeRequest): Promise<InitializeResponse> {
		return this.request<InitializeResponse>(ACP_METHODS.initialize, req)
	}
	authenticate(req: AuthenticateRequest): Promise<AuthenticateResponse> {
		return this.request<AuthenticateResponse>(ACP_METHODS.authenticate, req)
	}
	newSession(req: NewSessionRequest): Promise<NewSessionResponse> {
		return this.request<NewSessionResponse>(ACP_METHODS.sessionNew, req)
	}
	loadSession(req: LoadSessionRequest): Promise<LoadSessionResponse> {
		return this.request<LoadSessionResponse>(ACP_METHODS.sessionLoad, req)
	}
	prompt(req: PromptRequest): Promise<PromptResponse> {
		return this.request<PromptResponse>(ACP_METHODS.sessionPrompt, req)
	}
	setMode(req: SetSessionModeRequest): Promise<SetSessionModeResponse> {
		return this.request<SetSessionModeResponse>(ACP_METHODS.sessionSetMode, req)
	}
	setConfigOption(req: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> {
		return this.request<SetSessionConfigOptionResponse>(ACP_METHODS.sessionSetConfigOption, req)
	}
	cancel(notif: CancelNotification): void {
		this.notify(ACP_METHODS.sessionCancel, notif)
	}

	// ─── Incoming handler registration ───────────────────────────────

	onSessionUpdate(handler: (notif: SessionNotification) => void): void {
		this.sessionUpdateHandler = handler
	}
	onRequestPermission(h: RequestPermissionHandler): void {
		this.requestPermissionHandler = h
	}
	onReadTextFile(h: ReadTextFileHandler): void {
		this.readTextFileHandler = h
	}
	onWriteTextFile(h: WriteTextFileHandler): void {
		this.writeTextFileHandler = h
	}
	onCreateTerminal(h: CreateTerminalHandler): void {
		this.createTerminalHandler = h
	}
	onTerminalOutput(h: TerminalOutputHandler): void {
		this.terminalOutputHandler = h
	}
	onTerminalKill(h: TerminalKillHandler): void {
		this.terminalKillHandler = h
	}
	onTerminalRelease(h: TerminalReleaseHandler): void {
		this.terminalReleaseHandler = h
	}
	onTerminalWaitForExit(h: TerminalWaitForExitHandler): void {
		this.terminalWaitForExitHandler = h
	}
	/**
	 * Register a handler for an arbitrary ACP extension method (e.g.
	 * `cursor/create_plan`, `cursor/update_todos`, `cursor/ask_question`).
	 * Returns a dispose function to unregister.
	 */
	onExtensionRequest(method: string, handler: ExtensionRequestHandler): () => void {
		this.extensionHandlers.set(method, handler)
		return () => {
			if (this.extensionHandlers.get(method) === handler) {
				this.extensionHandlers.delete(method)
			}
		}
	}

	// ─── Wire layer ──────────────────────────────────────────────────

	/** Send a request and await its response. */
	private request<T>(method: string, params: unknown): Promise<T> {
		if (this.terminationError) return Promise.reject(this.terminationError)
		if (!this.child) return Promise.reject(new AcpTransportError("ACP client not started"))

		const id = this.nextId++
		const envelope: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				method,
				resolve: (v) => resolve(v as T),
				reject,
			})
			try {
				this.writeMessage(envelope)
			} catch (err) {
				this.pending.delete(id)
				reject(err instanceof Error ? err : new Error(String(err)))
			}
		})
	}

	/** Send a notification (no id, no response expected). */
	private notify(method: string, params: unknown): void {
		if (this.terminationError) return
		if (!this.child) return
		const envelope: JsonRpcNotification = { jsonrpc: "2.0", method, params }
		try {
			this.writeMessage(envelope)
		} catch (err) {
			log.warn("ACP notify failed", {
				method,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	private writeMessage(msg: object): void {
		const child = this.child
		if (!child) throw new AcpTransportError("ACP client not started")
		const line = `${JSON.stringify(msg)}\n`
		if (this.options.logWire) log.debug("ACP → out", { line: line.trim() })
		const ok = child.stdin.write(line, "utf8")
		if (!ok) {
			// We don't await drain — backpressure under normal load is fine; ACP
			// messages are small. If this becomes an issue, switch to a writer
			// queue with drain awaits.
		}
	}

	private handleIncomingLine(line: string): void {
		if (this.options.logWire) log.debug("ACP ← in", { line })
		let msg: unknown
		try {
			msg = JSON.parse(line)
		} catch (err) {
			log.warn("Failed to parse ACP wire line", {
				line: line.slice(0, 200),
				error: err instanceof Error ? err.message : String(err),
			})
			return
		}
		if (!msg || typeof msg !== "object") return
		const m = msg as Partial<JsonRpcMessage>

		// Response: has `id` AND (`result` OR `error`)
		if ("id" in m && m.id !== null && m.id !== undefined && ("result" in m || "error" in m)) {
			this.handleResponse(m as never)
			return
		}

		// Request: has `id` AND `method`
		if (
			"id" in m &&
			m.id !== null &&
			m.id !== undefined &&
			"method" in m &&
			typeof m.method === "string"
		) {
			this.handleIncomingRequest(m as JsonRpcRequest)
			return
		}

		// Notification: has `method` but no `id`
		if ("method" in m && typeof m.method === "string") {
			this.handleNotification(m as JsonRpcNotification)
			return
		}

		log.warn("Unrecognized ACP message", { sample: line.slice(0, 200) })
	}

	private handleResponse(msg: {
		id: number | string
		result?: unknown
		error?: { code: number; message: string; data?: unknown }
	}): void {
		const id = typeof msg.id === "string" ? Number(msg.id) : msg.id
		if (typeof id !== "number" || Number.isNaN(id)) return
		const pending = this.pending.get(id)
		if (!pending) {
			log.warn("ACP response for unknown id", { id })
			return
		}
		this.pending.delete(id)
		if (msg.error) {
			pending.reject(new AcpProtocolError(msg.error.code, msg.error.message, msg.error.data))
			return
		}
		pending.resolve(msg.result)
	}

	private handleNotification(msg: JsonRpcNotification): void {
		if (msg.method === ACP_METHODS.sessionUpdate) {
			if (!this.sessionUpdateHandler) return
			try {
				this.sessionUpdateHandler(msg.params as SessionNotification)
			} catch (err) {
				log.warn("session/update handler threw", {
					error: err instanceof Error ? err.message : String(err),
				})
			}
			return
		}
		// Any other notification (session/elicitation/complete, etc.) — ignore for now.
		log.debug("Unhandled ACP notification", { method: msg.method })
	}

	private handleIncomingRequest(msg: JsonRpcRequest): void {
		const id = msg.id
		const respond = (result: unknown): void => {
			this.writeMessage({ jsonrpc: "2.0", id, result })
		}
		const respondError = (code: number, message: string, data?: unknown): void => {
			this.writeMessage({
				jsonrpc: "2.0",
				id,
				error: { code, message, ...(data !== undefined ? { data } : {}) },
			})
		}

		const dispatch = async (): Promise<void> => {
			switch (msg.method) {
				case ACP_METHODS.sessionRequestPermission: {
					if (!this.requestPermissionHandler) {
						return respondError(-32601, "session/request_permission handler not registered")
					}
					const result = await this.requestPermissionHandler(msg.params as RequestPermissionRequest)
					return respond(result)
				}
				case ACP_METHODS.fsReadTextFile: {
					if (!this.readTextFileHandler) {
						return respondError(-32601, "fs/read_text_file handler not registered")
					}
					const result = await this.readTextFileHandler(msg.params as ReadTextFileRequest)
					return respond(result)
				}
				case ACP_METHODS.fsWriteTextFile: {
					if (!this.writeTextFileHandler) {
						return respondError(-32601, "fs/write_text_file handler not registered")
					}
					const result = await this.writeTextFileHandler(msg.params as WriteTextFileRequest)
					return respond(result)
				}
				case ACP_METHODS.terminalCreate: {
					if (!this.createTerminalHandler) {
						return respondError(-32601, "terminal/create handler not registered")
					}
					const result = await this.createTerminalHandler(msg.params as CreateTerminalRequest)
					return respond(result)
				}
				case ACP_METHODS.terminalOutput: {
					if (!this.terminalOutputHandler) {
						return respondError(-32601, "terminal/output handler not registered")
					}
					const result = await this.terminalOutputHandler(msg.params as TerminalOutputRequest)
					return respond(result)
				}
				case ACP_METHODS.terminalKill: {
					if (!this.terminalKillHandler) {
						return respondError(-32601, "terminal/kill handler not registered")
					}
					const result = await this.terminalKillHandler(msg.params as TerminalKillRequest)
					return respond(result)
				}
				case ACP_METHODS.terminalRelease: {
					if (!this.terminalReleaseHandler) {
						return respondError(-32601, "terminal/release handler not registered")
					}
					const result = await this.terminalReleaseHandler(msg.params as TerminalReleaseRequest)
					return respond(result)
				}
				case ACP_METHODS.terminalWaitForExit: {
					if (!this.terminalWaitForExitHandler) {
						return respondError(-32601, "terminal/wait_for_exit handler not registered")
					}
					const result = await this.terminalWaitForExitHandler(
						msg.params as TerminalWaitForExitRequest,
					)
					return respond(result)
				}
				default: {
					// Extension fallback — Cursor sends bespoke methods like
					// `cursor/create_plan` and `cursor/update_todos`. Honour any
					// registered handler; otherwise tell the agent we don't
					// implement it (they're optional in ACP).
					const ext = this.extensionHandlers.get(msg.method)
					if (!ext) {
						return respondError(-32601, `Method not found: ${msg.method}`)
					}
					try {
						const result = await ext(msg.params)
						return respond(result ?? {})
					} catch (err) {
						return respondError(-32603, err instanceof Error ? err.message : String(err))
					}
				}
			}
		}

		dispatch().catch((err) => {
			const message = err instanceof Error ? err.message : String(err)
			log.warn("ACP request handler threw", { method: msg.method, error: message })
			try {
				respondError(-32603, message)
			} catch {
				// transport gone
			}
		})
	}

	private terminate(err: Error): void {
		if (this.terminationError) return
		this.terminationError = err
		// Reject all pending
		for (const [, p] of this.pending) p.reject(err)
		this.pending.clear()
		// Notify exit waiters
		const waiters = this.exitWaiters
		this.exitWaiters = []
		for (const w of waiters) w(err)
	}
}

/**
 * Translate an unknown thrown value into a concise human-readable string.
 * Used by callers to package ACP errors into Loop's session-error events.
 */
export function describeAcpError(err: unknown): { code?: number; message: string; data?: unknown } {
	if (err instanceof AcpProtocolError) {
		return { code: err.code, message: err.message, data: err.data }
	}
	if (err instanceof Error) return { message: err.message }
	return { message: String(err) }
}

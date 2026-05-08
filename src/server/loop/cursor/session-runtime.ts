import { createLogger } from "../../logger"
import { Workspace } from "../../workspace"
import { AcpClient } from "./acp/client"
import type {
	InitializeResponse,
	NewSessionResponse,
	SessionConfigOption,
	SessionModeState,
} from "./acp/types"

/**
 * Per-Loop-session ACP runtime lifecycle.
 *
 * Each Loop session owns one `AcpClient` (and therefore one `agent acp`
 * subprocess). The ACP session is created on first turn and reused across
 * subsequent turns so Cursor's internal context survives. We persist the
 * ACP `sessionId` on the Loop session row so a process restart can call
 * `session/load` to resume.
 *
 * Turn rejection is handled at the dispatcher level — only one prompt at
 * a time per Loop session. ACP itself enforces single in-flight per
 * sessionId on the agent side.
 *
 * Cancellation: callers fire `session/cancel` via the client. After
 * cancel we keep the ACP client open so the next turn reuses the same
 * sessionId for context continuity.
 */

const log = createLogger("cursor-session-runtime")

export interface CursorSpawnConfig {
	/** Cursor binary path (or "agent" / "cursor"); resolved via $PATH. */
	command: string
	/** Extra args injected before the "acp" subcommand. */
	preArgs?: ReadonlyArray<string>
	env?: NodeJS.ProcessEnv
}

export interface EnsureCursorRuntimeArgs {
	loopSessionId: string
	cwd: string
	spawn: CursorSpawnConfig
	authMethodId: string
	clientInfo: { name: string; version: string }
	/** Persisted ACP sessionId from a prior turn, or undefined for fresh. */
	resumeAcpSessionId?: string
	/** Optional client capabilities (e.g. parameterizedModelPicker meta). */
	clientCapabilities?: import("./acp/types").ClientCapabilities
}

export interface CursorRuntime {
	loopSessionId: string
	client: AcpClient
	cwd: string
	acpSessionId: string
	closed: boolean
	signature: string
	initializeResponse: InitializeResponse
	sessionSetup:
		| NewSessionResponse
		| { configOptions?: ReadonlyArray<SessionConfigOption> | null; modes?: SessionModeState | null }
	configOptions: ReadonlyArray<SessionConfigOption>
	modeState: SessionModeState | undefined
	currentModelId: string | undefined
	/** True while a session/prompt is in-flight. */
	promptInFlight: boolean
}

const cursorRuntimes = Workspace.state(
	() => new Map<string, CursorRuntime>(),
	async (map) => {
		for (const rt of map.values()) {
			rt.closed = true
			try {
				await rt.client.dispose()
			} catch (err) {
				log.warn("AcpClient dispose threw on workspace close", {
					sessionId: rt.loopSessionId,
					error: err instanceof Error ? err.message : String(err),
				})
			}
		}
		map.clear()
	},
)

function signatureOf(args: { cwd: string; command: string }): string {
	return `${args.command}::${args.cwd}`
}

export function getCursorRuntime(loopSessionId: string): CursorRuntime | undefined {
	return cursorRuntimes().get(loopSessionId)
}

/**
 * Ensure a live ACP runtime for this Loop session. Reuses the cached one
 * when its (cwd, command) signature matches; otherwise tears the old one
 * down and rebuilds.
 *
 * The caller wires session/update + permission + fs/terminal handlers on
 * the returned client BEFORE issuing the prompt.
 */
export async function ensureCursorRuntime(args: EnsureCursorRuntimeArgs): Promise<CursorRuntime> {
	const runtimes = cursorRuntimes()
	const sig = signatureOf({ cwd: args.cwd, command: args.spawn.command })
	const existing = runtimes.get(args.loopSessionId)
	if (existing && !existing.closed && existing.signature === sig) {
		return existing
	}
	if (existing) {
		await closeCursorRuntime(args.loopSessionId)
	}

	log.info("Starting Cursor ACP runtime", {
		loopSessionId: args.loopSessionId,
		command: args.spawn.command,
		cwd: args.cwd,
	})

	const acpArgs = [...(args.spawn.preArgs ?? []), "acp"]
	const client = new AcpClient({
		command: args.spawn.command,
		args: acpArgs,
		cwd: args.cwd,
		env: args.spawn.env ?? process.env,
	})
	await client.start()

	let initializeResponse: InitializeResponse
	let acpSessionId: string
	let sessionSetup:
		| NewSessionResponse
		| { configOptions?: ReadonlyArray<SessionConfigOption> | null; modes?: SessionModeState | null }

	try {
		initializeResponse = await client.initialize({
			protocolVersion: 1,
			clientCapabilities: {
				// We don't implement fs/terminal handlers ourselves — Cursor uses
				// its own internal file IO when these are false. Matches t3code.
				fs: { readTextFile: false, writeTextFile: false },
				terminal: false,
				...(args.clientCapabilities ?? {}),
			},
			clientInfo: args.clientInfo,
		})

		await client.authenticate({ methodId: args.authMethodId })

		if (args.resumeAcpSessionId) {
			try {
				const loaded = await client.loadSession({
					sessionId: args.resumeAcpSessionId,
					cwd: args.cwd,
					mcpServers: [],
				})
				acpSessionId = args.resumeAcpSessionId
				sessionSetup = loaded
			} catch (err) {
				log.info("session/load failed, creating fresh", {
					loopSessionId: args.loopSessionId,
					error: err instanceof Error ? err.message : String(err),
				})
				const created = await client.newSession({ cwd: args.cwd, mcpServers: [] })
				acpSessionId = created.sessionId
				sessionSetup = created
			}
		} else {
			const created = await client.newSession({ cwd: args.cwd, mcpServers: [] })
			acpSessionId = created.sessionId
			sessionSetup = created
		}
	} catch (err) {
		await client.dispose()
		throw err
	}

	const runtime: CursorRuntime = {
		loopSessionId: args.loopSessionId,
		client,
		cwd: args.cwd,
		acpSessionId,
		closed: false,
		signature: sig,
		initializeResponse,
		sessionSetup,
		configOptions: sessionSetup.configOptions ?? [],
		modeState: sessionSetup.modes ?? undefined,
		currentModelId: undefined,
		promptInFlight: false,
	}
	runtimes.set(args.loopSessionId, runtime)
	return runtime
}

/**
 * Apply config option updates returned from set_config_option / load /
 * new responses.
 */
export function updateRuntimeConfigOptions(
	loopSessionId: string,
	configOptions: ReadonlyArray<SessionConfigOption> | null | undefined,
): void {
	if (!configOptions) return
	const rt = cursorRuntimes().get(loopSessionId)
	if (!rt) return
	rt.configOptions = configOptions
}

/** Best-effort fire-and-forget cancel. */
export function cancelCursorRuntime(loopSessionId: string): void {
	const rt = cursorRuntimes().get(loopSessionId)
	if (!rt || rt.closed) return
	try {
		rt.client.cancel({ sessionId: rt.acpSessionId })
	} catch (err) {
		log.warn("session/cancel notify threw", {
			loopSessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

/** Tear down the per-session runtime — disposes the ACP client subprocess. */
export async function closeCursorRuntime(loopSessionId: string): Promise<void> {
	const runtimes = cursorRuntimes()
	const rt = runtimes.get(loopSessionId)
	if (!rt) return
	runtimes.delete(loopSessionId)
	rt.closed = true
	try {
		await rt.client.dispose()
	} catch (err) {
		log.warn("AcpClient dispose threw", {
			loopSessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

/**
 * Dispose every runtime across every workspace. Used at server shutdown.
 */
export async function closeAllCursorRuntimes(): Promise<void> {
	const directories = Workspace.list()
	await Promise.all(
		directories.map(async (dir) => {
			const ctx = Workspace.get(dir)
			if (!ctx) return
			await Workspace.run(ctx, async () => {
				const runtimes = cursorRuntimes()
				const ids = Array.from(runtimes.keys())
				await Promise.all(ids.map((id) => closeCursorRuntime(id)))
			})
		}),
	)
}

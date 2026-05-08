import { createLogger } from "../../logger"
import { AcpClient } from "./acp/client"
import type { ContentBlock, SessionNotification } from "./acp/types"

const log = createLogger("cursor-title")

/** Wallclock cap on the one-shot title call. */
const TITLE_TIMEOUT_MS = 15_000

const CURSOR_AUTH_METHOD_ID = "cursor_login"
const CLIENT_INFO = { name: "loop", version: "0.1.0" } as const

/**
 * Generate a session title via a one-shot Cursor ACP session.
 *
 * Mirrors `claude-code/title.ts`'s `generateClaudeCodeTitle` pattern and
 * t3code's `CursorTextGeneration.generateThreadTitle`: spawn an
 * isolated `agent acp` subprocess against the same binary the main
 * session uses, send the user's first message as a title-generation
 * prompt, accumulate the streamed text response, then dispose.
 *
 * Cursor's synthetic provider isn't registered with `ProviderRegistry`,
 * so the model-based path in `ensureSessionTitle` can't run for cursor
 * sessions. Without this customGenerator, cursor sessions would fall
 * through to deterministic derivation (just the first 50 chars of the
 * user message) — which is what was happening before.
 *
 * Returns a sanitised title, or `undefined` on any failure — callers
 * fall back to deterministic derivation in that case.
 */
export async function generateCursorTitle(args: {
	command: string
	args?: ReadonlyArray<string>
	cwd: string
	env?: NodeJS.ProcessEnv
	userMessage: string
}): Promise<string | undefined> {
	const userMessage = args.userMessage.trim()
	if (!args.command || !userMessage) return undefined

	const acpArgs = [...(args.args ?? []), "acp"]
	const client = new AcpClient({
		command: args.command,
		args: acpArgs,
		cwd: args.cwd,
		...(args.env ? { env: args.env } : {}),
	})

	let buffer = ""
	const onUpdate = (notif: SessionNotification): void => {
		try {
			const update = notif.update as { sessionUpdate?: string; content?: ContentBlock }
			if (
				update.sessionUpdate === "agent_message_chunk" &&
				update.content &&
				update.content.type === "text" &&
				typeof update.content.text === "string"
			) {
				buffer += update.content.text
			}
		} catch {
			// ignore malformed notifications — best-effort title gen.
		}
	}
	client.onSessionUpdate(onUpdate)

	const timer = setTimeout(() => {
		try {
			client.dispose()
		} catch {
			/* ignore */
		}
	}, TITLE_TIMEOUT_MS)

	try {
		await client.start()
		await client.initialize({
			protocolVersion: 1,
			clientCapabilities: {
				fs: { readTextFile: false, writeTextFile: false },
				terminal: false,
			},
			clientInfo: CLIENT_INFO,
		})
		await client.authenticate({ methodId: CURSOR_AUTH_METHOD_ID })
		const session = await client.newSession({ cwd: args.cwd, mcpServers: [] })

		const promptText = buildPrompt(userMessage)
		const block: ContentBlock = { type: "text", text: promptText }
		await client.prompt({ sessionId: session.sessionId, prompt: [block] })

		return parseAndSanitize(buffer)
	} catch (err) {
		log.warn("Cursor title generation failed", {
			error: err instanceof Error ? err.message : String(err),
		})
		return undefined
	} finally {
		clearTimeout(timer)
		try {
			await client.dispose()
		} catch {
			/* ignore */
		}
	}
}

function buildPrompt(userMessage: string): string {
	return [
		"You write concise titles for coding conversations.",
		"Output ONLY the title — no quotes, no preamble, no explanation, no JSON wrapping, no code fences.",
		"Keep it 3-8 words, summarising the user's request without restating it verbatim.",
		"",
		"User request:",
		userMessage,
	].join("\n")
}

function parseAndSanitize(raw: string): string | undefined {
	let text = raw.trim()
	if (!text) return undefined

	// If the model wrapped the title in JSON ({"title":"..."}), unwrap it.
	if (text.startsWith("{")) {
		try {
			const parsed = JSON.parse(text) as { title?: unknown }
			if (typeof parsed.title === "string") text = parsed.title
		} catch {
			// fall through — we'll sanitise the raw text instead
		}
	}

	// Take the first non-empty line — guards against multi-line preamble.
	const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0)
	if (!firstLine) return undefined
	text = firstLine.trim()

	// Strip surrounding quotes and trailing punctuation a model often adds.
	text = text.replace(/^["'“‘]+|["'”’.!?,]+$/g, "").trim()
	if (!text) return undefined

	if (text.length > 50) {
		const truncated = text.slice(0, 50)
		const lastSpace = truncated.lastIndexOf(" ")
		text = (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trimEnd()
	}
	return text || undefined
}

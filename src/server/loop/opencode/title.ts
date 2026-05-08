import * as Config from "../../config"
import { createLogger } from "../../logger"
import { detectOpenCode } from "../../provider/opencode"
import { connectOpenCode } from "../../provider/opencode/client"
import { parseOpenCodeModelId } from "../../provider/opencode/constants"

const log = createLogger("opencode-title")

/** Wallclock cap on the title call. */
const TITLE_TIMEOUT_MS = 15_000

/**
 * Generate a session title via a one-shot `session.prompt` call against
 * OpenCode. Mirrors `claude-code/title.ts` — the synthetic `opencode`
 * provider isn't registered with `ProviderRegistry`, so the standard
 * model-based path in `ensureSessionTitle` can't resolve it. We open a
 * throwaway connection, create an isolated session with `permission: deny
 * *` (so a slip can't trigger tools), prompt for the title, and tear it
 * down.
 *
 * Returns the sanitised title, or `undefined` on any failure — callers
 * fall back to deterministic derivation in that case.
 */
export async function generateOpenCodeTitle(args: {
	cwd: string
	upstreamProviderId: string
	upstreamModelId: string
	userMessage: string
}): Promise<string | undefined> {
	const { cwd, upstreamProviderId, upstreamModelId, userMessage } = args
	if (!userMessage.trim()) return undefined

	const detection = await detectOpenCode().catch(() => undefined)
	if (!detection?.installed || !detection.connected) {
		log.info("Skip OpenCode title — not connected")
		return undefined
	}

	const settings = Config.read().opencode
	const isRemote = settings.serverUrl.trim().length > 0

	const connection = await connectOpenCode({
		binaryPath: detection.binaryPath ?? settings.binaryPath,
		directory: cwd,
		...(isRemote ? { serverUrl: settings.serverUrl } : {}),
		...(isRemote && settings.serverPassword ? { serverPassword: settings.serverPassword } : {}),
	}).catch((err) => {
		log.warn("OpenCode title connect failed", {
			error: err instanceof Error ? err.message : String(err),
		})
		return undefined
	})
	if (!connection) return undefined

	const abort = new AbortController()
	const timer = setTimeout(() => abort.abort(), TITLE_TIMEOUT_MS)

	try {
		const created = await connection.client.session.create({
			directory: cwd,
			title: "Loop title generation",
			// Block every tool — we just want a one-shot text completion.
			permission: [{ permission: "*", pattern: "*", action: "deny" }],
		})
		const sessionID = created.data?.id
		if (!sessionID) {
			log.warn("OpenCode title session.create returned no id")
			return undefined
		}

		const prompt = buildPrompt(userMessage)
		const result = await connection.client.session.prompt({
			sessionID,
			directory: cwd,
			model: { providerID: upstreamProviderId, modelID: upstreamModelId },
			parts: [{ type: "text", text: prompt }],
		})

		const text = collectText(result.data?.parts)
		return sanitizeTitle(text)
	} catch (err) {
		if (abort.signal.aborted) {
			log.warn("OpenCode title timed out")
		} else {
			log.warn("OpenCode title generation failed", {
				error: err instanceof Error ? err.message : String(err),
			})
		}
		return undefined
	} finally {
		clearTimeout(timer)
		await connection.dispose().catch(() => {
			/* swallow */
		})
	}
}

/**
 * Variant that resolves model IDs from a Loop-format slug (`provider/model`)
 * — convenient for the runtime's call site. Returns `undefined` when the
 * slug is malformed.
 */
export async function generateOpenCodeTitleFromSlug(args: {
	cwd: string
	loopModelId: string
	userMessage: string
}): Promise<string | undefined> {
	const parsed = parseOpenCodeModelId(args.loopModelId)
	if (!parsed) return undefined
	return generateOpenCodeTitle({
		cwd: args.cwd,
		upstreamProviderId: parsed.upstreamProviderId,
		upstreamModelId: parsed.upstreamModelId,
		userMessage: args.userMessage,
	})
}

function buildPrompt(userMessage: string): string {
	return [
		"You write concise titles for coding conversations.",
		"Output ONLY the title — no quotes, no preamble, no explanation.",
		"Keep it 3-8 words, summarising the user's request without restating it verbatim.",
		"",
		"User request:",
		userMessage,
	].join("\n")
}

function collectText(parts: ReadonlyArray<unknown> | undefined): string {
	return (parts ?? [])
		.flatMap((part) => {
			if (!part || typeof part !== "object") return []
			const obj = part as { type?: string; text?: string }
			if (obj.type === "text" && typeof obj.text === "string") return [obj.text]
			return []
		})
		.join("")
		.trim()
}

function sanitizeTitle(raw: string): string | undefined {
	if (!raw) return undefined
	// Take the first non-empty line to guard against multi-line preamble.
	const firstLine = raw.split(/\r?\n/).find((l) => l.trim().length > 0)
	if (!firstLine) return undefined
	let text = firstLine.trim()
	// Strip surrounding quotes/punctuation a model often adds.
	text = text.replace(/^["'“‘]+|["'”’.!?,]+$/g, "").trim()
	if (!text) return undefined
	if (text.length > 50) {
		const truncated = text.slice(0, 50)
		const lastSpace = truncated.lastIndexOf(" ")
		text = (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trimEnd()
	}
	return text || undefined
}

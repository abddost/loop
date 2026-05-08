import { execFile } from "node:child_process"
import { createLogger } from "../../logger"

const log = createLogger("claude-code-title")

/** Wallclock cap on the one-shot title call. */
const TITLE_TIMEOUT_MS = 15_000

/** Output envelope returned by `claude -p --output-format json`. */
interface ClaudeJsonEnvelope {
	type?: string
	subtype?: string
	is_error?: boolean
	result?: string
}

/**
 * Generate a session title via a one-shot `claude -p` subprocess.
 *
 * Mirrors t3code's `runClaudeJson` pattern: spawn an isolated CLI call
 * against the same binary the main session uses, pipe the user's first
 * message on stdin, and read back a short title. The call is bounded
 * (`--max-turns 1`) so it can't kick off tools or run away.
 *
 * Returns a sanitised title, or `undefined` on any failure — callers
 * fall back to deterministic derivation in that case.
 */
export async function generateClaudeCodeTitle(args: {
	binaryPath: string
	cwd: string
	apiModelId: string
	userMessage: string
}): Promise<string | undefined> {
	const { binaryPath, cwd, apiModelId, userMessage } = args
	if (!binaryPath || !userMessage.trim()) return undefined

	const prompt = buildPrompt(userMessage)

	return new Promise<string | undefined>((resolve) => {
		const child = execFile(
			binaryPath,
			["-p", "--output-format", "json", "--max-turns", "1", "--model", apiModelId],
			{
				cwd,
				timeout: TITLE_TIMEOUT_MS,
				env: process.env,
				maxBuffer: 1024 * 1024,
			},
			(err, stdout) => {
				if (err) {
					log.warn("claude -p failed for title", { error: err.message })
					resolve(undefined)
					return
				}
				resolve(parseAndSanitize(stdout))
			},
		)

		try {
			child.stdin?.write(prompt)
			child.stdin?.end()
		} catch (err) {
			log.warn("Failed to write title prompt to stdin", {
				error: err instanceof Error ? err.message : String(err),
			})
		}
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

function parseAndSanitize(stdout: string): string | undefined {
	const raw = stdout.trim()
	if (!raw) return undefined

	let text: string | undefined
	try {
		const parsed = JSON.parse(raw) as ClaudeJsonEnvelope
		if (parsed && !parsed.is_error && typeof parsed.result === "string") {
			text = parsed.result
		}
	} catch {
		// Fall through — sometimes the CLI prints non-JSON before the result.
		text = raw
	}
	if (!text) return undefined

	text = text.trim()
	// Take the first non-empty line — guards against multi-line preamble.
	const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0)
	if (!firstLine) return undefined
	text = firstLine.trim()

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

import {
	type SDKUserMessage,
	type SlashCommand,
	query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk"
import { createLogger } from "../../logger"

/**
 * Probe + cache for the Claude Code SDK's `query.supportedCommands()`.
 *
 * Claude Code's `/` palette includes built-ins (`/clear`, `/compact`,
 * `/cost`, `/help`, `/init`, `/memory`, `/model`, `/resume`, etc.), the
 * user's `~/.claude/commands/*.md`, and the project's
 * `.claude/commands/*.md`. The list depends on the cwd (project commands)
 * and the CLI binary (built-ins + plugins) so we cache by both.
 *
 * Mirrors t3code's `probeClaudeCapabilities()`: we spawn a transient SDK
 * `query()` whose `prompt` iterable never yields, await
 * `supportedCommands()` (which resolves once the SDK has read its
 * initialisation packet from the CLI subprocess), interrupt, and let the
 * iterator close. No API request hits Anthropic.
 *
 * Re-export of the SDK's own type so route + frontend stay decoupled
 * from the SDK package.
 */
export type ClaudeCodeSlashCommand = SlashCommand

const log = createLogger("claude-code-commands")

interface CacheEntry {
	commands: ClaudeCodeSlashCommand[]
	expiresAt: number
}

/** 5-minute TTL — short enough that adding a `.claude/commands/foo.md`
 *  during a session shows up after a brief delay, long enough that
 *  a session's `/` palette doesn't re-probe on every keystroke. */
const CACHE_TTL_MS = 5 * 60 * 1000

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<ClaudeCodeSlashCommand[]>>()

function cacheKey(binaryPath: string, cwd: string): string {
	return `${binaryPath}::${cwd}`
}

/**
 * Return the slash command list for a given Claude Code binary + cwd.
 * Cached for 5 minutes; concurrent callers share a single inflight probe.
 */
export async function getClaudeCodeCommands(
	binaryPath: string,
	cwd: string,
): Promise<ClaudeCodeSlashCommand[]> {
	const key = cacheKey(binaryPath, cwd)
	const now = Date.now()
	const hit = cache.get(key)
	if (hit && hit.expiresAt > now) return hit.commands

	const pending = inflight.get(key)
	if (pending) return pending

	const probe = probeOnce(binaryPath, cwd)
		.then((commands) => {
			cache.set(key, { commands, expiresAt: Date.now() + CACHE_TTL_MS })
			return commands
		})
		.catch((err) => {
			log.warn("Failed to probe Claude Code commands", {
				binaryPath,
				cwd,
				error: err instanceof Error ? err.message : String(err),
			})
			// Cache an empty list briefly so the UI gets a clean response
			// instead of spamming the probe on every keystroke after a
			// transient failure.
			cache.set(key, { commands: [], expiresAt: Date.now() + 30 * 1000 })
			return [] as ClaudeCodeSlashCommand[]
		})
		.finally(() => {
			inflight.delete(key)
		})

	inflight.set(key, probe)
	return probe
}

/** Drop the cached commands for a binary+cwd pair. Call after the user
 *  edits .claude/commands/* so the next `/` re-probes. Currently exposed
 *  for completeness; not yet wired into a watcher. */
export function invalidateClaudeCodeCommands(binaryPath: string, cwd: string): void {
	cache.delete(cacheKey(binaryPath, cwd))
}

/** Spawn a transient probe SDK query and read `supportedCommands()`. */
async function probeOnce(
	binaryPath: string,
	cwd: string,
): Promise<ClaudeCodeSlashCommand[]> {
	// Never-yielding async iterable — keeps the query alive long enough
	// to read its init packet without ever sending a prompt.
	const prompt: AsyncIterable<SDKUserMessage> = {
		[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage, undefined> {
			return {
				next: () => new Promise<IteratorResult<SDKUserMessage, undefined>>(() => {}),
				return: () => Promise.resolve({ value: undefined, done: true }),
			}
		},
	}

	const q = sdkQuery({
		prompt,
		options: {
			pathToClaudeCodeExecutable: binaryPath,
			cwd,
			settingSources: ["user", "project", "local"],
			env: process.env as Record<string, string>,
		},
	})

	try {
		const commands = await q.supportedCommands()
		return commands ?? []
	} finally {
		try {
			await q.interrupt()
		} catch {
			// best-effort
		}
	}
}

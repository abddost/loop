import { useCallback, useEffect, useRef, useState } from "react"
import type { SlashCommandRow } from "../components/input/slash-command-menu"
import { apiClient } from "../lib/api-client"

interface UseSlashCommandsOptions {
	/** Workspace directory — keys both the cache and the request header. */
	directory: string | undefined
	/** Lazy-fetch trigger: only fires the network call once the consumer
	 *  actually needs the palette (typically when the user types `/`). */
	enabled: boolean
}

interface UseSlashCommandsReturn {
	commands: SlashCommandRow[]
	loading: boolean
	error: string | null
}

// Cross-component cache keyed by workspace directory. Slash commands
// don't vary by session — they're a property of the project + the
// installed Claude Code binary — so one fetch per workspace serves
// every input bar (and every session) inside it. The cache survives for
// the app's lifetime; `/commands` is cheap server-side (5-min probe
// cache) and the list rarely changes.
const cache = new Map<string, SlashCommandRow[]>()
const inflight = new Map<string, Promise<SlashCommandRow[]>>()

/**
 * Prime the slash-command cache for a workspace at startup.
 *
 * Called from `bootstrap.ts` so the `/` palette is already populated by
 * the time the user opens a chat — no loading flicker on first `/`.
 * Cheap to call unconditionally: the server returns `{ commands: [] }`
 * fast when Claude Code isn't installed (no probe spawned), and the
 * probe result itself is cached server-side for 5 minutes.
 *
 * Fire-and-forget: a failure here just means the hook falls back to its
 * own lazy fetch on first `/`.
 */
export function prefetchSlashCommands(directory: string): void {
	if (cache.has(directory) || inflight.has(directory)) return
	const promise = apiClient
		.get<{ commands: SlashCommandRow[] }>("/commands", { directory })
		.then((res) => {
			const list = res.commands ?? []
			cache.set(directory, list)
			return list
		})
		.catch(() => {
			// Swallow — the hook will retry lazily.
			return [] as SlashCommandRow[]
		})
		.finally(() => {
			inflight.delete(directory)
		})
	inflight.set(directory, promise)
}

/**
 * Workspace-global slash command palette. Replaces the earlier
 * `useClaudeCodeCommands(sessionId, ...)` per-session hook — the SDK's
 * `supportedCommands()` output depends on the cwd (project commands)
 * and the binary, never on the session, so caching by directory dedupes
 * every input bar inside a workspace.
 */
export function useSlashCommands({
	directory,
	enabled,
}: UseSlashCommandsOptions): UseSlashCommandsReturn {
	const [commands, setCommands] = useState<SlashCommandRow[]>(() =>
		directory ? (cache.get(directory) ?? []) : [],
	)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const fetchedRef = useRef<string | null>(null)

	const fetchCommands = useCallback(async (dir: string) => {
		if (cache.has(dir)) {
			setCommands(cache.get(dir) ?? [])
			return
		}
		const existing = inflight.get(dir)
		if (existing) {
			setLoading(true)
			try {
				setCommands(await existing)
			} finally {
				setLoading(false)
			}
			return
		}

		setLoading(true)
		setError(null)
		const promise = apiClient
			.get<{ commands: SlashCommandRow[] }>("/commands", { directory: dir })
			.then((res) => {
				const list = res.commands ?? []
				cache.set(dir, list)
				return list
			})
			.finally(() => {
				inflight.delete(dir)
			})
		inflight.set(dir, promise)

		try {
			setCommands(await promise)
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		if (!enabled || !directory) return
		if (fetchedRef.current === directory) return
		fetchedRef.current = directory
		void fetchCommands(directory)
	}, [enabled, directory, fetchCommands])

	return { commands, loading, error }
}

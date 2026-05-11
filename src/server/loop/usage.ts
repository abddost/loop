import type { UsagePart } from "@core/schema/part"
import { gte, isNull } from "drizzle-orm"
import * as Database from "../db"
import { messageTable, sessionTable } from "../db/schema"

/**
 * Time window for the `/usage` snapshot.
 *
 * `all` is lifetime, `30d` and `7d` are trailing-day windows. The
 * Usage card flips between these via tabs without a fresh slash command
 * (the renderer just re-asks the server with a new range).
 */
export type UsageRange = "all" | "30d" | "7d"

/**
 * Compute the aggregated usage snapshot.
 *
 * Aggregates GLOBALLY — every top-level session in the DB across all
 * projects — so the numbers reflect the user's lifetime loop2 usage
 * (matching the Claude Code CLI/desktop `/usage` semantics, which are
 * also account-wide). Loads sessions + their messages, then reduces the
 * metadata JSON in memory. SQLite's `json_extract` would let us sum
 * tokens server-side, but message metadata shapes drift across
 * providers — pulling rows and reducing in TS keeps the schema flexible.
 */
export function computeUsage(range: UsageRange): UsagePart {
	const db = Database.get()
	const now = Date.now()
	const cutoff =
		range === "all" ? 0 : now - daysToMs(range === "30d" ? 30 : 7)

	// All top-level sessions (exclude child/subagent sessions; archived
	// ones still count — usage is about everything the user has ever
	// done, not just what's currently in the sidebar).
	const sessions = db
		.select({ id: sessionTable.id })
		.from(sessionTable)
		.where(isNull(sessionTable.parentId))
		.all()
	const sessionIds = new Set(sessions.map((s) => s.id))

	// One bulk read for every message in range, then drop any belonging
	// to a child session (SQLite `IN (...)` with a Set is awkward in
	// Drizzle and the in-memory filter is cheap).
	const messages = db
		.select({
			sessionId: messageTable.sessionId,
			role: messageTable.role,
			metadata: messageTable.metadata,
			createdAt: messageTable.createdAt,
		})
		.from(messageTable)
		.where(gte(messageTable.createdAt, cutoff))
		.all()
		.filter((m) => sessionIds.has(m.sessionId))

	// Per-day buckets for the heatmap + active-day count + streak.
	const byDay = new Map<string, number>()
	const hourCounts = new Array<number>(24).fill(0)
	const modelTotals = new Map<
		string,
		{ tokens: number; input: number; output: number; cached: number; cost: number }
	>()
	const activeSessionIds = new Set<string>()

	let totalMessages = 0
	let totalTokens = 0
	let totalCost = 0

	for (const msg of messages) {
		const meta = msg.metadata as
			| {
					tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
					cost?: number
					modelId?: string
					usageSnapshot?: unknown
			  }
			| null
			| undefined

		// Skip our own `/usage` snapshot messages (both the user marker
		// and the assistant card). Counting them would inflate the
		// message count and pollute the heatmap with self-referential
		// activity. Both carry `metadata.usageSnapshot === true`.
		if (meta?.usageSnapshot) continue

		totalMessages++
		activeSessionIds.add(msg.sessionId)

		const day = isoDay(msg.createdAt)
		byDay.set(day, (byDay.get(day) ?? 0) + 1)

		const hour = new Date(msg.createdAt).getHours()
		hourCounts[hour]++

		// Token + cost aggregation only applies to assistant turns —
		// user messages don't carry usage metadata.
		if (msg.role !== "assistant") continue
		const t = meta?.tokens
		const stepTokens =
			(t?.input ?? 0) + (t?.output ?? 0) + (t?.cacheRead ?? 0) + (t?.cacheWrite ?? 0)
		totalTokens += stepTokens
		totalCost += meta?.cost ?? 0

		const modelId = meta?.modelId ?? "unknown"
		const entry = modelTotals.get(modelId) ?? {
			tokens: 0,
			input: 0,
			output: 0,
			cached: 0,
			cost: 0,
		}
		entry.tokens += stepTokens
		entry.input += t?.input ?? 0
		entry.output += t?.output ?? 0
		entry.cached += (t?.cacheRead ?? 0) + (t?.cacheWrite ?? 0)
		entry.cost += meta?.cost ?? 0
		modelTotals.set(modelId, entry)
	}

	const peakHour = hourCounts.reduce(
		(best, count, hour) => (count > best.count ? { hour, count } : best),
		{ hour: -1, count: 0 },
	).hour

	const favoriteModel = pickFavoriteModel(modelTotals)
	const { current, longest } = computeStreaks(byDay, range, now)
	const heatmap = buildHeatmap(byDay, range, now)
	const comparison = buildComparison(totalTokens)

	return {
		type: "usage",
		range,
		stats: {
			sessions: activeSessionIds.size,
			messages: totalMessages,
			totalTokens,
			activeDays: byDay.size,
			currentStreak: current,
			longestStreak: longest,
			peakHour,
			favoriteModel,
			totalCost,
		},
		models: [...modelTotals.entries()]
			.sort((a, b) => b[1].tokens - a[1].tokens)
			.map(([modelId, totals]) => ({ modelId, ...totals })),
		heatmap,
		comparison,
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

function daysToMs(days: number): number {
	return days * DAY_MS
}

function isoDay(epoch: number): string {
	const d = new Date(epoch)
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, "0")
	const day = String(d.getDate()).padStart(2, "0")
	return `${y}-${m}-${day}`
}

function pickFavoriteModel(
	totals: Map<string, { tokens: number; input: number; output: number; cached: number; cost: number }>,
): string | null {
	let bestModel: string | null = null
	let bestTokens = 0
	for (const [modelId, t] of totals) {
		if (t.tokens > bestTokens) {
			bestModel = modelId
			bestTokens = t.tokens
		}
	}
	return bestModel
}

/**
 * Walk backwards from today counting consecutive active days for the
 * current streak; walk through every day in `byDay` for the longest
 * streak. Days without messages break the streak.
 */
function computeStreaks(
	byDay: Map<string, number>,
	range: UsageRange,
	now: number,
): { current: number; longest: number } {
	if (byDay.size === 0) return { current: 0, longest: 0 }

	const days = [...byDay.keys()].sort()
	let longest = 0
	let run = 0
	let prev: string | undefined
	for (const day of days) {
		if (prev && dayDiff(prev, day) === 1) run++
		else run = 1
		if (run > longest) longest = run
		prev = day
	}

	let current = 0
	let cursor = isoDay(now)
	while (byDay.has(cursor)) {
		current++
		cursor = isoDay(parseDay(cursor) - DAY_MS)
	}
	if (range === "30d") current = Math.min(current, 30)
	if (range === "7d") current = Math.min(current, 7)
	return { current, longest }
}

function dayDiff(a: string, b: string): number {
	return Math.round((parseDay(b) - parseDay(a)) / DAY_MS)
}

function parseDay(iso: string): number {
	const [y, m, d] = iso.split("-").map((s) => Number.parseInt(s, 10))
	return new Date(y, m - 1, d).getTime()
}

/**
 * Build a chronological list of `{date, messages}` entries spanning the
 * requested range. The card lays them out into a calendar grid client-
 * side; we hand it raw counts so it can pick its own grouping.
 */
function buildHeatmap(
	byDay: Map<string, number>,
	range: UsageRange,
	now: number,
): UsagePart["heatmap"] {
	const today = isoDay(now)
	const out: UsagePart["heatmap"] = []
	if (range === "all") {
		const days = [...byDay.keys()].sort()
		if (days.length === 0) {
			// Even an empty timeline gets ~16 weeks of zeros so the grid
			// renders consistently rather than collapsing.
			let cursor = parseDay(today) - 16 * 7 * DAY_MS
			while (cursor <= parseDay(today)) {
				out.push({ date: isoDay(cursor), messages: 0 })
				cursor += DAY_MS
			}
			return out
		}
		// Span from the earliest active day to today, dense (zeros for
		// gaps so the heatmap renders contiguously).
		let cursor = parseDay(days[0])
		const end = parseDay(today)
		while (cursor <= end) {
			const iso = isoDay(cursor)
			out.push({ date: iso, messages: byDay.get(iso) ?? 0 })
			cursor += DAY_MS
		}
		return out
	}

	const span = range === "30d" ? 30 : 7
	for (let i = span - 1; i >= 0; i--) {
		const iso = isoDay(now - i * DAY_MS)
		out.push({ date: iso, messages: byDay.get(iso) ?? 0 })
	}
	return out
}

/**
 * Tongue-in-cheek comparison line shown under the heatmap, scaled to
 * book token counts so the number always sounds vivid. Mirrors the
 * "~1230× more tokens than Animal Farm" copy in the design.
 *
 * Exported for unit tests; the result lives inside the `UsagePart`.
 */
export function buildComparison(totalTokens: number): string | undefined {
	if (totalTokens === 0) return undefined
	const books: Array<{ name: string; tokens: number }> = [
		{ name: "Animal Farm", tokens: 39_000 },
		{ name: "The Great Gatsby", tokens: 65_000 },
		{ name: "1984", tokens: 119_000 },
		{ name: "Pride and Prejudice", tokens: 162_000 },
		{ name: "The Lord of the Rings", tokens: 615_000 },
		{ name: "War and Peace", tokens: 750_000 },
	]
	// Pick the largest book the user has surpassed by at least 2×.
	const eligible = books.filter((b) => totalTokens >= b.tokens * 2)
	const target = eligible.at(-1) ?? books[0]
	const ratio = Math.round(totalTokens / target.tokens)
	if (ratio < 2) return undefined
	return `You've used ~${ratio.toLocaleString()}× more tokens than ${target.name}.`
}

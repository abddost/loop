import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"

type EffectCollector = (cb: () => void) => void

/**
 * Execute a function within a transaction. Collected effect callbacks
 * fire ONLY after the transaction commits successfully.
 * Prevents SSE events for data that doesn't exist in DB yet.
 */
export function withEffects<TSchema extends Record<string, unknown>, T>(
	db: BunSQLiteDatabase<TSchema>,
	fn: (
		tx: Parameters<Parameters<BunSQLiteDatabase<TSchema>["transaction"]>[0]>[0],
		effect: EffectCollector,
	) => T,
): T {
	const effects: Array<() => void> = []
	const result = db.transaction((tx) => {
		return fn(tx, (cb) => effects.push(cb))
	})
	// Post-commit: fire all collected effects
	for (const effect of effects) {
		try {
			effect()
		} catch (e) {
			console.error("[db:effect] Error in post-commit effect:", e)
		}
	}
	return result
}

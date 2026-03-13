import { Database as BunDB } from "bun:sqlite"
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { withEffects as withEffectsImpl } from "./effect"
import { runMigrations } from "./migrate"
import * as schema from "./schema"

type DB = BunSQLiteDatabase<typeof schema>

let instance: DB | undefined
let raw: InstanceType<typeof BunDB> | undefined

/** Initialize DB at startup. Call once. */
export function init(path: string): void {
	if (instance) throw new Error("Database already initialized")
	raw = new BunDB(path)
	raw.run("PRAGMA journal_mode = WAL")
	raw.run("PRAGMA busy_timeout = 5000")
	raw.run("PRAGMA synchronous = NORMAL")
	raw.run("PRAGMA foreign_keys = ON")
	instance = drizzle(raw, { schema })
	runMigrations(instance)
}

/** Get Drizzle instance. Throws if not initialized. */
export function get(): DB {
	if (!instance) throw new Error("Database not initialized. Call init() first.")
	return instance
}

/** Execute with post-commit effects. */
export function withEffects<T>(
	fn: (tx: Parameters<Parameters<DB["transaction"]>[0]>[0], effect: (cb: () => void) => void) => T,
): T {
	return withEffectsImpl(get(), fn)
}

/** Close DB. Call on process exit. */
export function close(): void {
	raw?.close()
	instance = undefined
	raw = undefined
}

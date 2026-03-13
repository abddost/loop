import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"

/** Run all pending migrations from the drizzle folder. */
export function runMigrations<TSchema extends Record<string, unknown>>(
	db: BunSQLiteDatabase<TSchema>,
): void {
	migrate(db, { migrationsFolder: "./drizzle" })
}

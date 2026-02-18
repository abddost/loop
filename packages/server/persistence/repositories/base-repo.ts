/**
 * BaseRepository -- shared helpers for all repositories.
 *
 * Provides:
 *   - parseJson / toJson with proper error handling
 *   - stmt() for prepared statement caching
 *   - transaction() wrapper for atomic multi-statement operations
 */

import type { Database, Statement } from 'bun:sqlite';

export abstract class BaseRepository {
  private stmtCache = new Map<string, Statement>();

  constructor(protected db: Database) {}

  /**
   * Return a cached prepared statement for the given SQL.
   * Prepares and caches on first call; returns the cached version thereafter.
   */
  protected stmt(sql: string): Statement {
    let cached = this.stmtCache.get(sql);
    if (cached) return cached;
    cached = this.db.prepare(sql);
    this.stmtCache.set(sql, cached);
    return cached;
  }

  /**
   * Safely parse a JSON string from the database.
   * Returns null if the input is null/undefined.
   * Throws with context if the JSON is malformed.
   */
  protected parseJson<T>(json: string | null | undefined): T | null {
    if (json == null) return null;
    try {
      return JSON.parse(json) as T;
    } catch (err) {
      throw new Error(`Failed to parse JSON from database: ${err}`);
    }
  }

  /**
   * Safely stringify a value for database storage.
   * Returns null if the input is null/undefined.
   */
  protected toJson(data: unknown): string | null {
    if (data == null) return null;
    return JSON.stringify(data);
  }

  /**
   * Execute a function inside a native SQLite transaction.
   * Uses bun:sqlite's built-in transaction() for C-level performance.
   */
  protected transaction<T>(fn: () => T): T {
    const wrapped = this.db.transaction(fn);
    return wrapped();
  }
}

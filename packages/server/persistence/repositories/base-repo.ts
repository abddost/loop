/**
 * BaseRepository -- shared helpers for all repositories.
 *
 * Provides:
 *   - parseJson / toJson with proper error handling
 *   - transaction() wrapper for atomic multi-statement operations
 */

import type { Database } from 'bun:sqlite';

export abstract class BaseRepository {
  constructor(protected db: Database) {}

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
   * Execute a function inside a SQLite transaction.
   * Rolls back on error and re-throws.
   */
  protected transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

/**
 * SQLite database management using better-sqlite3.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DATABASE_FILE_NAME } from '@coding-assistant/shared';

let db: Database.Database | null = null;

export function getDatabase(dataDir?: string): Database.Database {
  if (db) return db;

  const dir = dataDir ?? join(process.cwd(), '.coding-assistant');
  mkdirSync(dir, { recursive: true });

  const dbPath = join(dir, DATABASE_FILE_NAME);
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

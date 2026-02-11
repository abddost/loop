/**
 * SQLite database management using bun:sqlite (Bun's built-in SQLite driver).
 */

import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DATABASE_FILE_NAME } from '@coding-assistant/shared';

let db: Database | null = null;

export function getDatabase(dataDir?: string): Database {
  if (db) return db;

  const dir = dataDir ?? join(process.cwd(), '.coding-assistant');
  mkdirSync(dir, { recursive: true });

  const dbPath = join(dir, DATABASE_FILE_NAME);
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

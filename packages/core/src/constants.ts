/**
 * Core package constants -- centralized magic numbers.
 *
 * All tunable thresholds, limits, and defaults that were previously
 * scattered across multiple files. Gathered here so they're easy to
 * find, document, and (optionally) make configurable via workspace config.
 */

// ── Execution ─────────────────────────────────────────────────────────────

/** Number of identical consecutive tool calls before doom loop triggers */
export const DOOM_LOOP_THRESHOLD = 3;

// ── Timeline persistence ──────────────────────────────────────────────────

/** Debounce interval for flushing part updates to the database (ms) */
export const TIMELINE_FLUSH_INTERVAL_MS = 1000;

// ── File snapshots ────────────────────────────────────────────────────────

/** Maximum files tracked in a single snapshot (prevents OOM on huge repos) */
export const MAX_SNAPSHOT_FILES = 5000;

/** Maximum directory depth to traverse when capturing snapshots */
export const SNAPSHOT_MAX_DEPTH = 3;

// ── Git state ─────────────────────────────────────────────────────────────

/** Timeout for git CLI commands (ms) */
export const GIT_COMMAND_TIMEOUT_MS = 5000;

// ── Auto-summary ──────────────────────────────────────────────────────────

/** Maximum character length for auto-generated session titles */
export const SESSION_TITLE_MAX_LENGTH = 60;

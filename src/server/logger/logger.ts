/**
 * Structured logger with module scoping, log levels, and trace spans.
 *
 * Usage:
 *   const log = createLogger("loop")
 *   log.info("Session started", { sessionId })
 *   log.error("Stream failed", { sessionId, error: err })
 *
 *   const span = log.span("compaction", { sessionId })
 *   // ... do work ...
 *   span.end()  // logs duration
 *
 * Levels: debug < info < warn < error
 * Set via LOG_LEVEL env var (default: "debug" in dev, "info" in production).
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

type LogMeta = Record<string, unknown>

export interface Logger {
	debug(msg: string, meta?: LogMeta): void
	info(msg: string, meta?: LogMeta): void
	warn(msg: string, meta?: LogMeta): void
	error(msg: string, meta?: LogMeta): void
	/** Create a child logger with additional default metadata. */
	child(meta: LogMeta): Logger
	/** Start a timed span. Call span.end() to log duration. */
	span(operation: string, meta?: LogMeta): Span
}

export interface Span {
	/** End the span and log its duration. Optionally merge extra metadata. */
	end(meta?: LogMeta): void
}

const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
}

let currentLevel: number = resolveDefaultLevel()

function resolveDefaultLevel(): number {
	const envLevel = process.env.LOG_LEVEL?.toLowerCase()
	if (envLevel && envLevel in LEVELS) {
		return LEVELS[envLevel as LogLevel]
	}
	return process.env.NODE_ENV === "production" ? LEVELS.info : LEVELS.debug
}

/** Override the global log level at runtime. */
export function setLogLevel(level: LogLevel): void {
	currentLevel = LEVELS[level]
}

/** Create a scoped logger for a module. */
export function createLogger(module: string, defaultMeta?: LogMeta): Logger {
	return buildLogger(module, defaultMeta ?? {})
}

function buildLogger(module: string, baseMeta: LogMeta): Logger {
	return {
		debug(msg, meta) {
			emit(LEVELS.debug, "debug", module, msg, merge(baseMeta, meta))
		},
		info(msg, meta) {
			emit(LEVELS.info, "info", module, msg, merge(baseMeta, meta))
		},
		warn(msg, meta) {
			emit(LEVELS.warn, "warn", module, msg, merge(baseMeta, meta))
		},
		error(msg, meta) {
			emit(LEVELS.error, "error", module, msg, merge(baseMeta, meta))
		},
		child(childMeta) {
			return buildLogger(module, { ...baseMeta, ...childMeta })
		},
		span(operation, meta) {
			const start = performance.now()
			const spanMeta = merge(baseMeta, meta)
			return {
				end(endMeta) {
					const durationMs = Math.round(performance.now() - start)
					emit(LEVELS.info, "info", module, `${operation} completed`, {
						...spanMeta,
						...endMeta,
						durationMs,
					})
				},
			}
		},
	}
}

function merge(base: LogMeta, extra?: LogMeta): LogMeta | undefined {
	if (!extra) return Object.keys(base).length > 0 ? base : undefined
	return { ...base, ...extra }
}

function emit(level: number, levelName: string, module: string, msg: string, meta?: LogMeta): void {
	if (level < currentLevel) return

	const entry: Record<string, unknown> = {
		ts: new Date().toISOString(),
		level: levelName,
		module,
		msg,
	}

	if (meta) {
		for (const [k, v] of Object.entries(meta)) {
			if (v instanceof Error) {
				entry[k] = { message: v.message, stack: v.stack }
			} else {
				entry[k] = v
			}
		}
	}

	const line = JSON.stringify(entry)

	switch (level) {
		case LEVELS.error:
			console.error(line)
			break
		case LEVELS.warn:
			console.warn(line)
			break
		default:
			console.log(line)
			break
	}
}

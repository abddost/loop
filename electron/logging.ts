/**
 * Rotating file sink for structured log output.
 *
 * Appends log lines to a file, rotating when the file exceeds maxBytes.
 * Numbered backup files (.1, .2, ...) are maintained up to maxFiles.
 * All operations are synchronous and never throw — a crashed logger
 * must never take down the app.
 */

import * as fs from "node:fs"
import * as path from "node:path"

export class RotatingFileSink {
	private fd: number | null = null
	private currentSize = 0
	private readonly filePath: string
	private readonly maxBytes: number
	private readonly maxFiles: number

	constructor(
		filePath: string,
		opts: { maxBytes?: number; maxFiles?: number } = {},
	) {
		this.filePath = filePath
		this.maxBytes = opts.maxBytes ?? 10 * 1024 * 1024 // 10 MB
		this.maxFiles = opts.maxFiles ?? 10

		try {
			fs.mkdirSync(path.dirname(filePath), { recursive: true })
			this.pruneOverflow()
			this.openFile()
		} catch {
			// Silent — logging must never crash the app
		}
	}

	write(data: string): void {
		try {
			if (this.fd === null) this.openFile()
			if (this.fd === null) return

			const buf = Buffer.from(data)
			fs.writeSync(this.fd, buf)
			this.currentSize += buf.length

			if (this.currentSize >= this.maxBytes) {
				this.rotate()
			}
		} catch {
			// Silent
		}
	}

	writeLine(line: string): void {
		const timestamp = new Date().toISOString()
		this.write(`[${timestamp}] ${line}\n`)
	}

	close(): void {
		if (this.fd !== null) {
			try {
				fs.closeSync(this.fd)
			} catch {
				// Silent
			}
			this.fd = null
		}
	}

	private openFile(): void {
		try {
			this.fd = fs.openSync(this.filePath, "a")
			try {
				const stat = fs.fstatSync(this.fd)
				this.currentSize = stat.size
			} catch {
				this.currentSize = 0
			}
		} catch {
			this.fd = null
		}
	}

	private rotate(): void {
		this.close()
		try {
			// Shift existing backups: .9 → .10, .8 → .9, etc.
			for (let i = this.maxFiles - 1; i >= 1; i--) {
				const from = `${this.filePath}.${i}`
				const to = `${this.filePath}.${i + 1}`
				try {
					fs.renameSync(from, to)
				} catch {
					// File may not exist yet
				}
			}
			// Current → .1
			fs.renameSync(this.filePath, `${this.filePath}.1`)
		} catch {
			// If rotation fails, truncate and continue
			try {
				fs.writeFileSync(this.filePath, "")
			} catch {
				// Silent
			}
		}
		this.openFile()
	}

	private pruneOverflow(): void {
		// Remove any backup files beyond maxFiles
		for (let i = this.maxFiles + 1; i <= this.maxFiles + 10; i++) {
			try {
				fs.unlinkSync(`${this.filePath}.${i}`)
			} catch {
				break // No more files to prune
			}
		}
	}
}

// ── Stdio Capture ───────────────────────────────────────────────────────────

const originalStdoutWrite = process.stdout.write.bind(process.stdout)
const originalStderrWrite = process.stderr.write.bind(process.stderr)

/**
 * Patch stdout/stderr to also write to a RotatingFileSink.
 * Only call this in packaged builds — dev uses the terminal.
 */
export function captureStdio(sink: RotatingFileSink): void {
	const patchStream = (
		stream: NodeJS.WriteStream,
		original: typeof process.stdout.write,
	) => {
		stream.write = ((
			chunk: string | Uint8Array,
			encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
			cb?: (err?: Error | null) => void,
		): boolean => {
			const text =
				typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8")
			sink.write(text)
			if (typeof encodingOrCb === "function") {
				return original(chunk, encodingOrCb)
			}
			return original(chunk, encodingOrCb, cb)
		}) as typeof stream.write
	}

	patchStream(process.stdout, originalStdoutWrite)
	patchStream(process.stderr, originalStderrWrite)
}

/**
 * Restore stdout/stderr to their original implementations.
 */
export function restoreStdio(): void {
	process.stdout.write = originalStdoutWrite
	process.stderr.write = originalStderrWrite
}

// ── Session Boundary ────────────────────────────────────────────────────────

export function writeSessionBoundary(
	sink: RotatingFileSink,
	type: "START" | "END",
	details: Record<string, unknown>,
): void {
	const line = `\n${"=".repeat(60)}\n  SIDECAR SESSION ${type}: ${JSON.stringify(details)}\n${"=".repeat(60)}\n`
	sink.write(line)
}

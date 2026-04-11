import { chmod, mkdir, stat, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getDataDir } from "../env"
import { createLogger } from "../logger"

const log = createLogger("ripgrep")

const VERSION = "14.1.1"

const PLATFORMS = {
	"arm64-darwin": { target: "aarch64-apple-darwin", ext: "tar.gz" },
	"x64-darwin": { target: "x86_64-apple-darwin", ext: "tar.gz" },
	"arm64-linux": { target: "aarch64-unknown-linux-gnu", ext: "tar.gz" },
	"x64-linux": { target: "x86_64-unknown-linux-musl", ext: "tar.gz" },
	"arm64-win32": { target: "aarch64-pc-windows-msvc", ext: "zip" },
	"x64-win32": { target: "x86_64-pc-windows-msvc", ext: "zip" },
} as const

type PlatformKey = keyof typeof PLATFORMS

function getBinDir(): string {
	return join(getDataDir(), "bin")
}

function getBinaryName(): string {
	return process.platform === "win32" ? "rg.exe" : "rg"
}

async function extractTarGz(archivePath: string, binDir: string): Promise<void> {
	const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

	const platformKey = `${process.arch}-${process.platform}` as PlatformKey
	if (platformKey.endsWith("-darwin")) {
		args.push("--include=*/rg")
	} else if (platformKey.endsWith("-linux")) {
		args.push("--wildcards", "*/rg")
	}

	const proc = Bun.spawn(args, {
		cwd: binDir,
		stdout: "pipe",
		stderr: "pipe",
	})

	const stderr = await new Response(proc.stderr).text()
	const exitCode = await proc.exited

	if (exitCode !== 0) {
		throw new Error(`Failed to extract ripgrep archive: ${stderr}`)
	}
}

async function extractZip(archiveBuffer: ArrayBuffer, binDir: string): Promise<void> {
	const { ZipReader, BlobReader, BlobWriter } = await import("@zip.js/zip.js")

	const reader = new ZipReader(new BlobReader(new Blob([archiveBuffer])))
	const entries = await reader.getEntries()

	const rgEntry = entries.find((e) => e.filename.endsWith("rg.exe"))
	if (!rgEntry || rgEntry.directory) {
		await reader.close()
		throw new Error("rg.exe not found in zip archive")
	}

	const blob = await rgEntry.getData(new BlobWriter())
	const buffer = Buffer.from(await blob.arrayBuffer())
	await writeFile(join(binDir, "rg.exe"), buffer)
	await reader.close()
}

async function download(): Promise<string> {
	const platformKey = `${process.arch}-${process.platform}` as PlatformKey
	const config = PLATFORMS[platformKey]
	if (!config) {
		throw new Error(`Unsupported platform: ${platformKey}`)
	}

	const binDir = getBinDir()
	await mkdir(binDir, { recursive: true })

	const binaryPath = join(binDir, getBinaryName())
	const filename = `ripgrep-${VERSION}-${config.target}.${config.ext}`
	const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`

	log.info("Downloading ripgrep", { version: VERSION, platform: platformKey, url })

	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`Failed to download ripgrep: HTTP ${response.status} from ${url}`)
	}

	const arrayBuffer = await response.arrayBuffer()

	if (config.ext === "tar.gz") {
		const archivePath = join(binDir, filename)
		await writeFile(archivePath, Buffer.from(arrayBuffer))
		try {
			await extractTarGz(archivePath, binDir)
		} finally {
			await unlink(archivePath).catch(() => {})
		}
	} else {
		try {
			await extractZip(arrayBuffer, binDir)
		} catch (err) {
			throw new Error(`Failed to extract ripgrep zip: ${err}`)
		}
	}

	if (process.platform !== "win32") {
		await chmod(binaryPath, 0o755)
	}

	log.info("Ripgrep installed", { path: binaryPath })
	return binaryPath
}

async function resolve(): Promise<string> {
	// 1. Check system PATH
	const systemPath = Bun.which("rg")
	if (systemPath) {
		try {
			const s = await stat(systemPath)
			if (s.isFile()) {
				log.info("Using system ripgrep", { path: systemPath })
				return systemPath
			}
		} catch {
			// Invalid path from which, fall through
		}
	}

	// 2. Check cached binary
	const cachedPath = join(getBinDir(), getBinaryName())
	try {
		const s = await stat(cachedPath)
		if (s.isFile()) {
			return cachedPath
		}
	} catch {
		// Not cached yet, fall through to download
	}

	// 3. Download and cache
	return download()
}

let initPromise: Promise<string> | null = null

/** Returns the absolute path to a working ripgrep binary. Downloads if necessary. */
export function getRipgrepPath(): Promise<string> {
	if (!initPromise) {
		initPromise = resolve().catch((err) => {
			initPromise = null // allow retry on next call
			throw err
		})
	}
	return initPromise
}

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { promisify } from "node:util"
import * as Config from "../../config"
import { createLogger } from "../../logger"
import { connectOpenCode } from "./client"
import { MIN_OPENCODE_CLI_VERSION, encodeOpenCodeModelId } from "./constants"

const log = createLogger("opencode:detect")
const exec = promisify(execFile)

/**
 * Result of probing the user's machine for an OpenCode CLI / server.
 *
 * `installed` means the binary was found on disk OR a remote `serverUrl`
 * was configured; `connected` means we successfully reached the server
 * and listed providers (i.e. credentials/network are working).
 */
export interface OpenCodeDetection {
	/** True when the CLI binary was found OR an external server URL is configured. */
	installed: boolean
	/** True when we successfully connected and listed providers. */
	connected: boolean
	/** Resolved binary path (omitted when an external server is configured). */
	binaryPath?: string
	/** OpenCode CLI version (omitted for external server mode). */
	version?: string
	/** Soft warning when the detected CLI is older than the floor. */
	versionWarning?: string
	/** External server URL when configured (mode === "remote"). */
	serverUrl?: string
	/** Connection mode based on user settings. */
	mode: "local" | "remote"
	/** Number of upstream providers OpenCode reports as connected. */
	connectedUpstreamCount?: number
	/** All discovered upstream provider IDs. */
	upstreamProviderIds?: string[]
	/** Discovered models, keyed by Loop model ID (`provider/model`). */
	models?: OpenCodeDiscoveredModel[]
	/** Present when detection failed. */
	error?: string
}

/** A model exposed by OpenCode, normalized for Loop's picker. */
export interface OpenCodeDiscoveredModel {
	/** Loop model ID — `${upstreamProviderId}/${upstreamModelId}` slug. */
	id: string
	/** Upstream provider id (e.g. "openai"). */
	upstreamProviderId: string
	/** Upstream model id (e.g. "gpt-5"). */
	upstreamModelId: string
	/** Upstream provider display name (e.g. "OpenAI"). */
	upstreamProviderName: string
	/** Display name (e.g. "GPT-5"). */
	name: string
	/** Optional family/group label. */
	family?: string
	supportsImages: boolean
	supportsTools: boolean
	supportsReasoning: boolean
	supportsTemperature: boolean
	contextWindow: number
	maxOutput: number
	pricing: { input: number; output: number; cacheRead: number; cacheWrite: number }
	status: "active" | "beta" | "deprecated"
	isUpstreamConnected: boolean
}

/**
 * Common install locations used as a fallback when a `$PATH` lookup misses
 * — Electron apps on macOS inherit a minimal `launchd` PATH that often
 * lacks user-installed binaries.
 */
const FALLBACK_PATHS = [
	"/opt/homebrew/bin/opencode",
	"/usr/local/bin/opencode",
	join(homedir(), ".opencode/bin/opencode"),
	join(homedir(), ".local/bin/opencode"),
	join(homedir(), ".bun/bin/opencode"),
	join(homedir(), ".volta/bin/opencode"),
	join(homedir(), ".cargo/bin/opencode"),
]

/** Module-level cache. Detection spawns a server, which is expensive. */
let cached: OpenCodeDetection | null = null
let detectPromise: Promise<OpenCodeDetection> | null = null

/**
 * Detect OpenCode availability and discover models.
 *
 * Results are cached per app session — call `rescanOpenCode()` after the user
 * installs the CLI, edits server settings, or runs `opencode auth login` so
 * we re-probe the upstream provider list.
 */
export async function detectOpenCode(opts: { force?: boolean } = {}): Promise<OpenCodeDetection> {
	if (!opts.force && cached) return cached
	if (detectPromise) return detectPromise
	detectPromise = runDetection()
	try {
		cached = await detectPromise
		return cached
	} finally {
		detectPromise = null
	}
}

/** Force a fresh detection pass. */
export async function rescanOpenCode(): Promise<OpenCodeDetection> {
	return detectOpenCode({ force: true })
}

/** Synchronously read the last detection result without re-running. */
export function getCachedOpenCodeDetection(): OpenCodeDetection | null {
	return cached
}

async function runDetection(): Promise<OpenCodeDetection> {
	const settings = readSettings()

	if (!settings.enabled) {
		return {
			installed: false,
			connected: false,
			mode: settings.serverUrl ? "remote" : "local",
			error: "OpenCode is disabled in Loop settings.",
		}
	}

	const isRemote = settings.serverUrl.trim().length > 0

	// Local mode: locate binary + check version before probing.
	let binaryPath: string | undefined
	let version: string | undefined
	let versionWarning: string | undefined
	if (!isRemote) {
		binaryPath = await locateBinary(settings.binaryPath)
		if (!binaryPath) {
			log.info("OpenCode CLI not found")
			return {
				installed: false,
				connected: false,
				mode: "local",
				error: "OpenCode CLI (`opencode`) is not installed or not on PATH.",
			}
		}
		try {
			version = await readVersion(binaryPath)
			versionWarning = checkVersionDrift(version)
		} catch (err) {
			log.warn("Failed to read opencode --version", { error: (err as Error).message })
		}
	}

	// Connect (spawn or attach) and list providers.
	let connection: Awaited<ReturnType<typeof connectOpenCode>> | undefined
	try {
		connection = await connectOpenCode({
			binaryPath: binaryPath ?? settings.binaryPath,
			directory: process.cwd(),
			...(isRemote ? { serverUrl: settings.serverUrl } : {}),
			...(isRemote && settings.serverPassword ? { serverPassword: settings.serverPassword } : {}),
		})

		const result = await connection.client.provider.list()
		const data = result.data
		if (!data) {
			throw new Error("OpenCode provider list returned no data.")
		}

		const connectedSet = new Set(data.connected)
		const models: OpenCodeDiscoveredModel[] = []
		for (const provider of data.all) {
			for (const model of Object.values(provider.models)) {
				models.push(toDiscoveredModel(provider, model, connectedSet.has(provider.id)))
			}
		}
		models.sort((a, b) => {
			if (a.isUpstreamConnected !== b.isUpstreamConnected) {
				return a.isUpstreamConnected ? -1 : 1
			}
			return a.name.localeCompare(b.name)
		})

		return {
			installed: true,
			connected: true,
			...(binaryPath ? { binaryPath } : {}),
			...(version ? { version } : {}),
			...(versionWarning ? { versionWarning } : {}),
			...(isRemote ? { serverUrl: settings.serverUrl } : {}),
			mode: isRemote ? "remote" : "local",
			connectedUpstreamCount: data.connected.length,
			upstreamProviderIds: data.all.map((p) => p.id),
			models,
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		log.warn("OpenCode detection failed", { error: message })
		return {
			installed: !isRemote ? Boolean(binaryPath) : true,
			connected: false,
			...(binaryPath ? { binaryPath } : {}),
			...(version ? { version } : {}),
			...(versionWarning ? { versionWarning } : {}),
			...(isRemote ? { serverUrl: settings.serverUrl } : {}),
			mode: isRemote ? "remote" : "local",
			error: humanizeProbeError({ message, isRemote, serverUrl: settings.serverUrl }),
		}
	} finally {
		await connection?.dispose()
	}
}

function readSettings() {
	const config = Config.read()
	return config.opencode
}

async function locateBinary(configuredPath: string): Promise<string | undefined> {
	// 1. Configured path: absolute → check existence; bare name → keep for shell lookup.
	const candidate = configuredPath.trim() || "opencode"
	if (candidate.includes("/") || candidate.includes("\\")) {
		return existsSync(candidate) ? candidate : undefined
	}

	// 2. Login-shell lookup (recovers user-installed PATH on macOS GUI launches).
	const viaShell = await locateViaLoginShell(candidate)
	if (viaShell && existsSync(viaShell)) return viaShell

	// 3. Hard-coded fallback locations.
	for (const path of FALLBACK_PATHS) {
		if (existsSync(path)) return path
	}

	// 4. `which` with the process's existing PATH as a last resort.
	try {
		const { stdout } = await exec("which", [candidate], { timeout: 3000 })
		const path = stdout.trim()
		if (path && existsSync(path)) return path
	} catch {
		/* nothing found */
	}
	return undefined
}

async function locateViaLoginShell(name: string): Promise<string | undefined> {
	const shell = process.env.SHELL || "/bin/zsh"
	try {
		const { stdout } = await exec(shell, ["-l", "-c", `command -v ${name}`], {
			timeout: 5000,
			env: { ...process.env, PATH: buildProbePath() },
		})
		const path = stdout.trim()
		return path || undefined
	} catch {
		return undefined
	}
}

function buildProbePath(): string {
	const extra = [
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		join(homedir(), ".opencode/bin"),
		join(homedir(), ".local/bin"),
		join(homedir(), ".bun/bin"),
		join(homedir(), ".volta/bin"),
		join(homedir(), ".cargo/bin"),
	]
	const existing = process.env.PATH ?? ""
	return [...extra, existing].filter(Boolean).join(delimiter)
}

async function readVersion(binaryPath: string): Promise<string | undefined> {
	const { stdout } = await exec(binaryPath, ["--version"], { timeout: 5000 })
	const match = stdout.trim().match(/(\d+\.\d+\.\d+[\w.-]*)/)
	return match?.[1] ?? stdout.trim().split(/\s+/)[0]
}

function checkVersionDrift(version: string | undefined): string | undefined {
	if (!version) return undefined
	const parsed = parseSemver(version)
	if (!parsed) return undefined
	const floor = parseSemver(MIN_OPENCODE_CLI_VERSION)
	if (!floor) return undefined
	if (compareSemver(parsed, floor) >= 0) return undefined
	return `OpenCode CLI ${version} is older than the tested floor (${MIN_OPENCODE_CLI_VERSION}). Some features may not work — run \`opencode upgrade\` to update.`
}

function parseSemver(v: string): [number, number, number] | undefined {
	const m = v.match(/^(\d+)\.(\d+)\.(\d+)/)
	if (!m) return undefined
	return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
	for (let i = 0; i < 3; i++) {
		const ai = a[i] ?? 0
		const bi = b[i] ?? 0
		if (ai !== bi) return ai - bi
	}
	return 0
}

function humanizeProbeError(input: {
	message: string
	isRemote: boolean
	serverUrl: string
}): string {
	const lower = input.message.toLowerCase()
	if (input.isRemote) {
		if (
			lower.includes("401") ||
			lower.includes("403") ||
			lower.includes("unauthorized") ||
			lower.includes("forbidden")
		) {
			return "OpenCode server rejected authentication. Check the server URL and password."
		}
		if (
			lower.includes("econnrefused") ||
			lower.includes("enotfound") ||
			lower.includes("fetch failed") ||
			lower.includes("networkerror") ||
			lower.includes("timed out") ||
			lower.includes("timeout") ||
			lower.includes("socket hang up")
		) {
			return `Couldn't reach OpenCode server at ${input.serverUrl}. Check the URL and that the server is running.`
		}
		return input.message
	}

	if (lower.includes("enoent") || lower.includes("notfound")) {
		return "OpenCode CLI (`opencode`) is not installed or not on PATH."
	}
	if (lower.includes("quarantine")) {
		return "macOS is blocking the OpenCode binary (quarantine). Run `xattr -d com.apple.quarantine $(which opencode)` to fix."
	}
	if (lower.includes("invalid code signature") || lower.includes("corrupted")) {
		return "macOS killed the OpenCode process due to an invalid code signature. Reinstall OpenCode."
	}
	return input.message || "Failed to start OpenCode."
}

function toDiscoveredModel(
	provider: { id: string; name: string },
	model: {
		id: string
		name: string
		family?: string
		capabilities: {
			temperature: boolean
			reasoning: boolean
			attachment: boolean
			toolcall: boolean
			input: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
			output: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
		}
		cost: { input: number; output: number; cache: { read: number; write: number } }
		limit: { context: number; output: number }
		status: "alpha" | "beta" | "deprecated" | "active"
	},
	isUpstreamConnected: boolean,
): OpenCodeDiscoveredModel {
	return {
		id: encodeOpenCodeModelId(provider.id, model.id),
		upstreamProviderId: provider.id,
		upstreamModelId: model.id,
		upstreamProviderName: provider.name,
		name: model.name,
		...(model.family ? { family: model.family } : {}),
		supportsImages: Boolean(model.capabilities.input.image),
		supportsTools: Boolean(model.capabilities.toolcall),
		supportsReasoning: Boolean(model.capabilities.reasoning),
		supportsTemperature: Boolean(model.capabilities.temperature),
		contextWindow: model.limit.context,
		maxOutput: model.limit.output,
		pricing: {
			input: model.cost.input,
			output: model.cost.output,
			cacheRead: model.cost.cache.read,
			cacheWrite: model.cost.cache.write,
		},
		status: model.status === "alpha" ? "beta" : model.status,
		isUpstreamConnected,
	}
}

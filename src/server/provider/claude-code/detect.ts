import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { promisify } from "node:util"
import { createLogger } from "../../logger"

const log = createLogger("claude-code:detect")
const exec = promisify(execFile)

/**
 * Result of probing the user's machine for a locally-installed Claude Code CLI.
 *
 * `installed` means the binary was found on disk; `authenticated` means the
 * user has a working `claude login` session. Both must be true before we route
 * prompts to the Claude Code runtime.
 */
export interface ClaudeCodeDetection {
	installed: boolean
	authenticated: boolean
	binaryPath?: string
	version?: string
	accountEmail?: string
	subscriptionType?: string
	/** Present when detection failed or the CLI is in an unusable state. */
	error?: string
	/**
	 * Soft warning when the detected CLI version is older than the floor Loop
	 * was built against. Non-fatal — we still try to run.
	 */
	versionWarning?: string
}

/**
 * Minimum Claude Code CLI version the Loop runtime was tested against.
 *
 * The Agent SDK (`@anthropic-ai/claude-agent-sdk`) spawns the user's local
 * `claude` binary, and older CLI builds may lack flags/events the SDK relies
 * on (notably `--print --input-format=stream-json` + the `stream_event`
 * message shape). If the detected version is below this floor we surface a
 * soft warning in settings; we still try to run because a lot of CLI builds
 * work fine but never advertise a clean semver.
 */
const MIN_COMPATIBLE_CLI_VERSION = "1.0.0"

/** Candidate install locations checked when `$PATH` lookup misses. */
const FALLBACK_PATHS = [
	"/opt/homebrew/bin/claude",
	"/usr/local/bin/claude",
	join(homedir(), ".claude/local/claude"),
	join(homedir(), ".local/bin/claude"),
	join(homedir(), ".npm-global/bin/claude"),
	join(homedir(), ".volta/bin/claude"),
	join(homedir(), ".bun/bin/claude"),
]

/** Module-level cache. Detection is expensive (spawns a shell + binary). */
let cached: ClaudeCodeDetection | null = null
let detectPromise: Promise<ClaudeCodeDetection> | null = null

/**
 * Detect the Claude Code CLI on the user's machine.
 *
 * Results are cached per app session. Use `detectClaudeCode({ force: true })`
 * or `rescanClaudeCode()` after the user installs/removes the CLI.
 */
export async function detectClaudeCode(
	opts: { force?: boolean } = {},
): Promise<ClaudeCodeDetection> {
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
export async function rescanClaudeCode(): Promise<ClaudeCodeDetection> {
	return detectClaudeCode({ force: true })
}

/** Synchronously read the last detection result without triggering a new run. */
export function getCachedDetection(): ClaudeCodeDetection | null {
	return cached
}

async function runDetection(): Promise<ClaudeCodeDetection> {
	try {
		const binaryPath = await locateBinary()
		if (!binaryPath) {
			log.info("Claude Code CLI not found on PATH or fallback locations")
			return { installed: false, authenticated: false }
		}

		const version = await readVersion(binaryPath)
		const auth = readAuthStatus()
		const versionWarning = checkVersionDrift(version)

		log.info("Claude Code CLI detected", {
			binaryPath,
			version,
			authenticated: auth.authenticated,
			versionWarning,
		})

		return {
			installed: true,
			authenticated: auth.authenticated,
			binaryPath,
			version,
			accountEmail: auth.email,
			subscriptionType: auth.subscriptionType,
			versionWarning,
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		log.warn("Claude Code detection failed", { error: message })
		return { installed: false, authenticated: false, error: message }
	}
}

/**
 * Locate the `claude` binary.
 *
 * GUI-launched Electron apps on macOS inherit a minimal `PATH` from
 * `launchd`, so `$PATH` lookups miss binaries installed via Homebrew, nvm,
 * volta, etc. We shell through the user's login shell first to get their
 * interactive PATH, then fall back to probing known install locations.
 */
async function locateBinary(): Promise<string | undefined> {
	const viaShell = await locateViaLoginShell()
	if (viaShell && existsSync(viaShell)) return viaShell

	for (const candidate of FALLBACK_PATHS) {
		if (existsSync(candidate)) return candidate
	}

	// Final attempt: raw `which` call using the process's existing PATH.
	try {
		const { stdout } = await exec("which", ["claude"], { timeout: 3000 })
		const path = stdout.trim()
		if (path && existsSync(path)) return path
	} catch {
		// ignore — nothing found
	}

	return undefined
}

async function locateViaLoginShell(): Promise<string | undefined> {
	const shell = process.env.SHELL || "/bin/zsh"
	try {
		const { stdout } = await exec(shell, ["-l", "-c", "command -v claude"], {
			timeout: 5000,
			env: { ...process.env, PATH: buildProbePath() },
		})
		const path = stdout.trim()
		return path || undefined
	} catch {
		return undefined
	}
}

/** Build a PATH that includes common install locations, just in case. */
function buildProbePath(): string {
	const extra = [
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		join(homedir(), ".claude/local"),
		join(homedir(), ".local/bin"),
		join(homedir(), ".bun/bin"),
		join(homedir(), ".volta/bin"),
	]
	const existing = process.env.PATH ?? ""
	return [...extra, existing].filter(Boolean).join(delimiter)
}

/**
 * Compare a detected CLI version against `MIN_COMPATIBLE_CLI_VERSION`.
 *
 * Returns a warning message when the CLI is older than the floor so the
 * settings card can surface it. Returns `undefined` when the version is
 * unknown or meets the floor — unknown versions are assumed compatible
 * because many package-manager builds strip the numeric prefix.
 */
function checkVersionDrift(version: string | undefined): string | undefined {
	if (!version) return undefined
	const parsed = parseSemver(version)
	if (!parsed) return undefined
	const floor = parseSemver(MIN_COMPATIBLE_CLI_VERSION)
	if (!floor) return undefined
	if (compareSemver(parsed, floor) >= 0) return undefined
	return `Claude Code CLI ${version} is older than the tested floor (${MIN_COMPATIBLE_CLI_VERSION}). Some features may not work — run \`claude update\` to upgrade.`
}

function parseSemver(v: string): [number, number, number] | undefined {
	const match = v.match(/^(\d+)\.(\d+)\.(\d+)/)
	if (!match) return undefined
	return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
	for (let i = 0; i < 3; i++) {
		const ai = a[i] ?? 0
		const bi = b[i] ?? 0
		if (ai !== bi) return ai - bi
	}
	return 0
}

async function readVersion(binaryPath: string): Promise<string | undefined> {
	try {
		const { stdout } = await exec(binaryPath, ["--version"], { timeout: 5000 })
		// Output is typically "1.2.3 (Claude Code)" — keep just the version token.
		const match = stdout.trim().match(/^(\d+\.\d+\.\d+[\w.-]*)/)
		return match?.[1] ?? stdout.trim().split(/\s+/)[0]
	} catch (err) {
		log.warn("Failed to read claude --version", { error: (err as Error).message })
		return undefined
	}
}

/**
 * Read auth status from `~/.claude.json`.
 *
 * The CLI writes session/OAuth data to this file after `claude login`. We
 * treat missing/corrupt files as unauthenticated rather than erroring — the
 * user just needs to run `claude login`.
 */
function readAuthStatus(): {
	authenticated: boolean
	email?: string
	subscriptionType?: string
} {
	const configPath = join(homedir(), ".claude.json")
	if (!existsSync(configPath)) {
		return { authenticated: false }
	}

	try {
		// Strip BOM (Windows) before parsing.
		const raw = readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")
		const parsed = JSON.parse(raw) as {
			oauthAccount?: { emailAddress?: string; organizationUuid?: string }
			userID?: string
			accountUUID?: string
			subscriptionType?: string
		}

		const authenticated = Boolean(
			parsed.oauthAccount?.emailAddress || parsed.userID || parsed.accountUUID,
		)
		return {
			authenticated,
			email: parsed.oauthAccount?.emailAddress,
			subscriptionType: parsed.subscriptionType,
		}
	} catch (err) {
		log.warn("Failed to parse ~/.claude.json", { error: (err as Error).message })
		return { authenticated: false }
	}
}

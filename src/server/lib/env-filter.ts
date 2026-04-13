/**
 * Default allowlist of environment variables that are safe to pass to
 * user-configured subprocesses (MCP stdio servers and similar).
 *
 * Secrets like API keys, OAuth tokens, and provider credentials are
 * deliberately excluded so a malicious MCP server cannot siphon them
 * out of the parent process. Callers that need specific secrets can
 * opt in via the `allow` parameter (populated from per-server config).
 */
export const SAFE_ENV_VARS: readonly string[] = [
	"HOME",
	"USERPROFILE", // Windows
	"PATH",
	"SHELL",
	"USER",
	"USERNAME", // Windows
	"LOGNAME",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TMPDIR",
	"TEMP",
	"TMP",
	"TERM",
	"COLUMNS",
	"LINES",
	"TZ",
	"PWD",
	"ProgramFiles", // Windows
	"ProgramFiles(x86)", // Windows
	"APPDATA", // Windows
	"LOCALAPPDATA", // Windows
] as const

/**
 * Build a restricted env object for a user-configured subprocess.
 *
 * @param allow - Extra env var names to include beyond the safe default set.
 *   Typically populated from per-server `envPassthrough` config so users can
 *   opt in to specific secrets on a per-server basis.
 * @param override - Explicit key/value pairs to set or override. These take
 *   precedence over anything inherited from `process.env`.
 * @returns A new env object suitable for passing to spawn().
 */
export function buildSubprocessEnv(
	allow: readonly string[] = [],
	override: Record<string, string> = {},
): Record<string, string> {
	const env: Record<string, string> = {}
	const names = new Set<string>([...SAFE_ENV_VARS, ...allow])
	for (const name of names) {
		const value = process.env[name]
		if (value !== undefined) env[name] = value
	}
	for (const [k, v] of Object.entries(override)) {
		env[k] = v
	}
	return env
}

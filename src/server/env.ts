import { homedir } from "node:os"
import { resolve } from "node:path"

export function getDataDir(): string {
	const xdg = process.env.XDG_DATA_HOME
	if (xdg) return resolve(xdg, "loop")
	return resolve(homedir(), ".local", "share", "loop")
}

const IS_DEV = process.env.NODE_ENV !== "production"

/**
 * Resolve the HTTP bind host. In production we force loopback so a
 * misconfigured `LOOP_HOST=0.0.0.0` cannot expose the unauthenticated
 * or weakly-authenticated control API to the network. The dev override
 * is kept so local hot-reload setups can still bind to `0.0.0.0` when
 * explicitly requested.
 */
function resolveHost(): string {
	const configured = process.env.LOOP_HOST
	if (!configured) return "127.0.0.1"
	if (IS_DEV) return configured
	// Production: accept only loopback addresses.
	const loopback = new Set(["127.0.0.1", "::1", "localhost"])
	if (loopback.has(configured)) return configured
	return "127.0.0.1"
}

export const env = {
	port: Number(process.env.LOOP_PORT ?? 4242),
	host: resolveHost(),
	authToken: process.env.LOOP_AUTH_TOKEN ?? "",
	dataDir: getDataDir(),
	dbPath: resolve(getDataDir(), "loop.db"),
	isDev: IS_DEV,
} as const

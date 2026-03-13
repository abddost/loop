import { homedir } from "node:os"
import { resolve } from "node:path"

export function getDataDir(): string {
	const xdg = process.env.XDG_DATA_HOME
	if (xdg) return resolve(xdg, "loop")
	return resolve(homedir(), ".local", "share", "loop")
}

export const env = {
	port: Number(process.env.LOOP_PORT ?? 4242),
	host: process.env.LOOP_HOST ?? "127.0.0.1",
	authToken: process.env.LOOP_AUTH_TOKEN ?? "",
	dataDir: getDataDir(),
	dbPath: resolve(getDataDir(), "loop.db"),
	isDev: process.env.NODE_ENV !== "production",
} as const

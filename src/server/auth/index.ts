import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { type AuthInfo, AuthInfoSchema } from "@core/schema/provider"
import { env } from "../env"

export const OAUTH_DUMMY_KEY = "loop-oauth-dummy-key"

const AUTH_FILE = resolve(env.dataDir, "auth.json")

// ─── File Operations ─────────────────────────────────────────────

function readAll(): Record<string, AuthInfo> {
	try {
		if (!existsSync(AUTH_FILE)) return {}
		const raw = readFileSync(AUTH_FILE, "utf-8")
		const data = JSON.parse(raw) as Record<string, unknown>
		const result: Record<string, AuthInfo> = {}
		for (const [key, value] of Object.entries(data)) {
			const parsed = AuthInfoSchema.safeParse(value)
			if (parsed.success) {
				result[key] = parsed.data
			}
		}
		return result
	} catch {
		return {}
	}
}

function writeAll(data: Record<string, AuthInfo>): void {
	const dir = dirname(AUTH_FILE)
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true })
	}
	writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 })
}

/** Normalize keys by stripping trailing slashes. */
function normalize(key: string): string {
	return key.replace(/\/+$/, "")
}

// ─── Auth Namespace ──────────────────────────────────────────────

export namespace Auth {
	/** Get auth info for a provider by ID. */
	export async function get(providerID: string): Promise<AuthInfo | undefined> {
		const data = readAll()
		return data[providerID]
	}

	/** Get all stored auth entries. */
	export async function all(): Promise<Record<string, AuthInfo>> {
		return readAll()
	}

	/** Save auth info for a key. Normalizes trailing slashes. */
	export async function set(key: string, info: AuthInfo): Promise<void> {
		const norm = normalize(key)
		const data = readAll()
		// Clean up both the raw key and any trailing-slash variant
		if (norm !== key) delete data[key]
		delete data[`${norm}/`]
		data[norm] = info
		writeAll(data)
	}

	/** Remove auth info for a key. Cleans up normalized variants. */
	export async function remove(key: string): Promise<void> {
		const norm = normalize(key)
		const data = readAll()
		delete data[key]
		delete data[norm]
		writeAll(data)
	}
}

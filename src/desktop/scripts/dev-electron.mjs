/**
 * Dev workflow orchestrator.
 *
 * Runs three parallel processes:
 *   1. Vite dev server (frontend on :1420)
 *   2. tsdown --watch (bundles electron/ → dist-electron/)
 *   3. Electron launcher (watches dist-electron/ for changes)
 *
 * The Bun server is NOT started separately — Electron's sidecar
 * spawns it automatically with --hot for live reload.
 */

import { spawn, execSync } from "node:child_process"
import { existsSync, watch } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "../../..")
const DIST_ELECTRON = resolve(ROOT, "dist-electron")
const MAIN_JS = resolve(DIST_ELECTRON, "main.cjs")
const PRELOAD_JS = resolve(DIST_ELECTRON, "preload.cjs")

const DEBOUNCE_MS = 120

let electronProcess = null
let debounceTimer = null

// ── Start Vite dev server ──
const vite = spawn("bun", ["run", "dev:app"], {
	cwd: ROOT,
	stdio: "inherit",
	env: { ...process.env },
})

// ── Start tsdown in watch mode (uses config for .js extensions) ──
const tsdown = spawn(
	"npx",
	[
		"tsdown",
		"--config", "src/desktop/tsdown.config.ts",
		"--watch",
	],
	{
		cwd: ROOT,
		stdio: "inherit",
		env: { ...process.env },
	},
)

// ── Wait for build output, then launch Electron ──
function waitForFiles() {
	return new Promise((resolve) => {
		const check = () => {
			if (existsSync(MAIN_JS) && existsSync(PRELOAD_JS)) {
				resolve()
			} else {
				setTimeout(check, 200)
			}
		}
		check()
	})
}

function launchElectron() {
	if (electronProcess) {
		try {
			electronProcess.kill()
		} catch {
			// Already dead
		}
		electronProcess = null
	}

	console.log("\n[dev] Starting Electron...\n")

	electronProcess = spawn(
		"npx",
		["electron", "."],
		{
			cwd: ROOT,
			stdio: "inherit",
			env: {
				...process.env,
				VITE_DEV_SERVER_URL: "http://localhost:1420",
			},
		},
	)

	electronProcess.on("exit", (code) => {
		if (code !== null) {
			console.log(`\n[dev] Electron exited with code ${code}`)
		}
	})
}

// ── Watch for main process changes ──
async function main() {
	console.log("[dev] Waiting for initial build...")
	await waitForFiles()

	// Small delay to ensure files are fully written
	await new Promise((r) => setTimeout(r, 500))

	launchElectron()

	// Watch for rebuilds of main process (not preload — that's hot-reloaded)
	try {
		watch(DIST_ELECTRON, { recursive: false }, (eventType, filename) => {
			if (!filename || !filename.endsWith(".cjs")) return

			// Debounce rapid file changes
			if (debounceTimer) clearTimeout(debounceTimer)
			debounceTimer = setTimeout(() => {
				debounceTimer = null
				console.log(`[dev] ${filename} changed, restarting Electron...`)
				launchElectron()
			}, DEBOUNCE_MS)
		})
	} catch (err) {
		console.error("[dev] Watch error:", err)
	}
}

// ── Cleanup on exit ──
function cleanup() {
	if (electronProcess) {
		try { electronProcess.kill() } catch {}
	}
	if (vite) {
		try { vite.kill() } catch {}
	}
	if (tsdown) {
		try { tsdown.kill() } catch {}
	}
	process.exit(0)
}

process.on("SIGINT", cleanup)
process.on("SIGTERM", cleanup)

main().catch((err) => {
	console.error("[dev] Fatal:", err)
	cleanup()
})

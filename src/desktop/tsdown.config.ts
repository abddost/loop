import { defineConfig } from "tsdown"

// electron and electron-updater must never be bundled:
// - `electron` is a built-in module provided by the Electron runtime
// - `electron-updater` uses native Electron APIs and must resolve at runtime
const neverBundle = ["electron", "electron-updater"]

export default defineConfig([
	{
		entry: ["./main.ts"],
		format: "cjs",
		outDir: "../../dist-electron",
		sourcemap: true,
		clean: true,
		deps: { neverBundle },
	},
	{
		entry: ["./preload.ts"],
		format: "cjs",
		outDir: "../../dist-electron",
		sourcemap: true,
		deps: { neverBundle },
	},
])

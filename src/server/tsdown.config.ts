import { defineConfig } from "tsdown"

// Modules that must NOT be bundled and must resolve from node_modules at runtime:
//  - bun-pty: native bindings (no .node file but uses bun:ffi to load .dylib)
//  - @parcel/watcher: native bindings (.node files per platform)
//  - electron-updater: pulled in transitively by some types; needs Electron APIs
const neverBundle = ["bun-pty", "@parcel/watcher", "electron-updater"]

export default defineConfig({
	entry: ["./index.ts"],
	format: "cjs",
	outDir: "../../dist-server",
	sourcemap: true,
	clean: true,
	platform: "node",
	deps: { neverBundle },
})

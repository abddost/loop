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
	// Single-file bundle. Without this tsdown emits split chunks that
	// `require()` shared deps (zod, etc.) at runtime — but in the packaged
	// app those node_modules live inside `app.asar`, which the bun sidecar
	// cannot read. One file means no runtime requires for bundled packages.
	// (`outputOptions.inlineDynamicImports` is deprecated upstream but is
	// the only thing that actually produces a single file in tsdown 0.21.
	// `codeSplitting: false` at the top level is silently ignored here.)
	outputOptions: {
		inlineDynamicImports: true,
	},
})

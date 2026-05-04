import { defineConfig } from "tsdown"

// Modules that must NOT be bundled and must resolve from node_modules at runtime:
//  - bun-pty: native bindings (no .node file but uses bun:ffi to load .dylib)
//  - @parcel/watcher: native bindings (.node files per platform)
//  - electron-updater: pulled in transitively by some types; needs Electron APIs
//  - @cursor/sdk: ships as a webpack-pre-bundled blob with `import "sqlite3"`
//    baked in via `__WEBPACK_EXTERNAL_MODULE_sqlite3__`. Bundling it again
//    pulls sqlite3's native loader into the output where it can't find its
//    .node file. Keep it external so it loads from node_modules where its
//    own peer deps (sqlite3, bindings, node-addon-api) are reachable.
const neverBundle = [
	"bun-pty",
	"@parcel/watcher",
	"electron-updater",
	"@cursor/sdk",
]

export default defineConfig({
	entry: ["./index.ts"],
	format: "cjs",
	outDir: "../../dist-server",
	sourcemap: true,
	clean: true,
	platform: "node",
	deps: {
		neverBundle,
		// tsdown defaults to externalising every package listed in
		// `dependencies` (the conventional behaviour for node-targeted
		// bundlers). Loop's packaged app deletes most of node_modules, so
		// every external require would fail at runtime. Force-bundle
		// everything that isn't explicitly held back above.
		alwaysBundle: /.*/,
	},
	// Single-file bundle. Without this tsdown emits split chunks that
	// `require()` shared deps at runtime — but in the packaged app those
	// node_modules live inside `app.asar`, which the bun sidecar cannot
	// read. (`outputOptions.inlineDynamicImports` is deprecated upstream
	// but is the only thing that actually produces a single file in
	// tsdown 0.21. `codeSplitting: false` at the top level is silently
	// ignored.)
	outputOptions: {
		inlineDynamicImports: true,
	},
})

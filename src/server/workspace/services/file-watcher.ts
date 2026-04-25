import { type FSWatcher, existsSync, watch } from "node:fs"
import { join, relative, resolve } from "node:path"
import { bus } from "../bus"
import { Workspace } from "../index"

type FileEvent = "add" | "change" | "unlink"

interface NativeSubscription {
	unsubscribe(): Promise<void>
}

/** Folder segments we never want to watch. */
const IGNORED_FOLDERS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".turbo",
	".cache",
	".output",
	"bower_components",
	"vendor",
	"__pycache__",
	".pytest_cache",
	".gradle",
	"target",
])

/** Glob patterns passed to @parcel/watcher's `ignore` option. */
const NATIVE_IGNORE_PATTERNS: string[] = [
	...Array.from(IGNORED_FOLDERS).map((d) => `**/${d}/**`),
	"**/*.swp",
	"**/*.swo",
	"**/*.pyc",
	"**/.DS_Store",
]

function isIgnored(relPath: string): boolean {
	if (!relPath) return true
	const segments = relPath.split(/[/\\]/)
	for (const seg of segments) {
		if (IGNORED_FOLDERS.has(seg)) return true
	}
	if (
		relPath.endsWith(".swp") ||
		relPath.endsWith(".swo") ||
		relPath.endsWith(".pyc") ||
		relPath.endsWith(".DS_Store")
	) {
		return true
	}
	return false
}

/**
 * File watcher service. Uses @parcel/watcher (platform-native: fs-events on
 * macOS, inotify on Linux, Windows API on Windows) with typed add/change/unlink
 * events. Falls back to fs.watch recursive if the native binding fails to load.
 * Events flow immediately — coalescing happens at the UI layer.
 */
class FileWatcherService {
	private nativeSubs: NativeSubscription[] = []
	private fsWatcher: FSWatcher | null = null
	private disposed = false
	/** Tracked paths for fs.watch fallback to distinguish add vs change vs unlink. */
	private knownPaths = new Set<string>()

	constructor(readonly directory: string) {}

	static async init(directory: string): Promise<FileWatcherService> {
		const service = new FileWatcherService(directory)
		await service.start()
		return service
	}

	private async start(): Promise<void> {
		const absDir = resolve(this.directory)
		if (!existsSync(absDir)) {
			console.warn(`[file-watcher] Directory does not exist, skipping: ${absDir}`)
			return
		}

		if (await this.startNative(absDir)) return
		this.startFsWatchFallback(absDir)
	}

	private async startNative(absDir: string): Promise<boolean> {
		try {
			const parcel = await import("@parcel/watcher")
			const sub = await parcel.subscribe(
				absDir,
				(err, events) => {
					if (this.disposed) return
					if (err) {
						console.error("[file-watcher] native subscription error:", err)
						return
					}
					for (const evt of events) {
						const rel = relative(absDir, evt.path)
						if (isIgnored(rel)) continue
						const kind: FileEvent =
							evt.type === "create" ? "add" : evt.type === "delete" ? "unlink" : "change"
						this.emit(rel, kind)
					}
				},
				{ ignore: NATIVE_IGNORE_PATTERNS },
			)
			this.nativeSubs.push(sub)
			return true
		} catch (err) {
			console.warn(
				"[file-watcher] @parcel/watcher unavailable, falling back to fs.watch:",
				err instanceof Error ? err.message : err,
			)
			return false
		}
	}

	private startFsWatchFallback(absDir: string): void {
		try {
			this.fsWatcher = watch(absDir, { recursive: true }, (_event, filename) => {
				if (this.disposed) return
				if (!filename) return
				const rel = filename.toString()
				if (isIgnored(rel)) return

				const abs = join(absDir, rel)
				const exists = existsSync(abs)
				let kind: FileEvent
				if (!exists) {
					kind = "unlink"
					this.knownPaths.delete(rel)
				} else if (this.knownPaths.has(rel)) {
					kind = "change"
				} else {
					kind = "add"
					this.knownPaths.add(rel)
				}
				this.emit(rel, kind)
			})
		} catch (err) {
			console.error("[file-watcher] fs.watch fallback failed:", err)
		}
	}

	private emit(path: string, event: FileEvent): void {
		try {
			bus().emit("file:changed", { path, event })
		} catch {
			// Bus may not be available if workspace is shutting down
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true
		for (const sub of this.nativeSubs) {
			await sub.unsubscribe().catch(() => {})
		}
		this.nativeSubs = []
		if (this.fsWatcher) {
			this.fsWatcher.close()
			this.fsWatcher = null
		}
		this.knownPaths.clear()
	}
}

/** Lazy-initialized file watcher for the current workspace. */
export const fileWatcher = Workspace.lazy(
	async () => FileWatcherService.init(Workspace.dir()),
	async (fw) => await fw.dispose(),
)

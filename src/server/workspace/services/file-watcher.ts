import { type FSWatcher, watch } from "node:fs"
import { bus } from "../bus"
import { Workspace } from "../index"

/** Directories to ignore when watching for file changes. */
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", ".cache"])

/** File watcher service — monitors filesystem changes in a workspace and emits bus events. */
class FileWatcherService {
	private watcher: FSWatcher | null = null
	private debounceTimer: ReturnType<typeof setTimeout> | null = null

	constructor(readonly directory: string) {}

	static async init(directory: string): Promise<FileWatcherService> {
		const service = new FileWatcherService(directory)
		service.start()
		return service
	}

	private start(): void {
		try {
			this.watcher = watch(this.directory, { recursive: true }, (_event, filename) => {
				if (!filename) return
				// Skip ignored directories
				const firstSegment = filename.split("/")[0]
				if (firstSegment && IGNORED_DIRS.has(firstSegment)) return

				this.scheduleNotify()
			})
		} catch (err) {
			console.error("[file-watcher] Failed to start watcher:", err)
		}
	}

	/** Debounce file change notifications to avoid flooding. */
	private scheduleNotify(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer)
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null
			try {
				bus().emit("vcs:changed", {})
			} catch {
				// Bus may not be available if workspace is shutting down
			}
		}, 500)
	}

	async dispose(): Promise<void> {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
		if (this.watcher) {
			this.watcher.close()
			this.watcher = null
		}
	}
}

/** Lazy-initialized file watcher for the current workspace. */
export const fileWatcher = Workspace.lazy(
	async () => FileWatcherService.init(Workspace.dir()),
	async (fw) => await fw.dispose(),
)

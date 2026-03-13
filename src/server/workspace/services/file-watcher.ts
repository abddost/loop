import { Workspace } from "../index"

/** Placeholder file watcher — monitors filesystem changes in a workspace. */
class FileWatcherService {
	constructor(readonly directory: string) {}

	static async init(directory: string): Promise<FileWatcherService> {
		return new FileWatcherService(directory)
	}

	async dispose(): Promise<void> {
		/* TODO */
	}
}

/** Lazy-initialized file watcher for the current workspace. */
export const fileWatcher = Workspace.lazy(
	async () => FileWatcherService.init(Workspace.dir()),
	async (fw) => await fw.dispose(),
)

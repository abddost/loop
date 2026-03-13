import { Workspace } from "../workspace"

class SnapshotManager {
	constructor(readonly directory: string) {}

	/** Create a SnapshotManager for the given directory. */
	static async init(directory: string): Promise<SnapshotManager> {
		return new SnapshotManager(directory)
	}

	/** Capture current filesystem state. Returns tree hash, or undefined on failure. */
	async capture(): Promise<string | undefined> {
		try {
			const proc = Bun.spawn(["git", "write-tree"], {
				cwd: this.directory,
				stdout: "pipe",
				stderr: "pipe",
			})
			const hash = await new Response(proc.stdout).text()
			return hash.trim() || undefined
		} catch {
			return undefined
		}
	}

	/**
	 * Get changed files between two tree hashes.
	 * @param fromHash - Starting tree hash
	 * @param toHash - Ending tree hash
	 * @returns List of changed file paths
	 */
	async changedFiles(fromHash: string, toHash: string): Promise<string[]> {
		try {
			const proc = Bun.spawn(
				["git", "diff-tree", "--no-commit-id", "--name-only", "-r", fromHash, toHash],
				{ cwd: this.directory, stdout: "pipe", stderr: "pipe" },
			)
			const output = await new Response(proc.stdout).text()
			return output.trim().split("\n").filter(Boolean)
		} catch {
			return []
		}
	}

	/** Clean up any resources held by the snapshot manager. */
	async dispose(): Promise<void> {}
}

/** Per-workspace snapshot manager. Lazy-initialized. */
export const snapshot = Workspace.lazy(
	async () => SnapshotManager.init(Workspace.dir()),
	async (s) => await s.dispose(),
)

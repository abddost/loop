import { join, relative } from "node:path"
import type { FileDiff } from "@core/schema/part"
import { createLogger } from "../logger"
import { Workspace } from "../workspace"

const log = createLogger("snapshot")

export interface SnapshotPatch {
	hash: string
	files: string[]
}

class SnapshotManager {
	constructor(readonly directory: string) {}

	static async init(directory: string): Promise<SnapshotManager> {
		return new SnapshotManager(directory)
	}

	// ─── Helpers ──────────────────────────────────────────────────

	private async git(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
		try {
			const proc = Bun.spawn(["git", ...args], {
				cwd: this.directory,
				stdout: "pipe",
				stderr: "pipe",
			})
			const [stdout, stderr] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
			])
			const code = await proc.exited
			return { code, stdout, stderr }
		} catch (err) {
			return { code: 1, stdout: "", stderr: String(err) }
		}
	}

	/** Stage all files (including untracked) so they are visible to write-tree. */
	async stageAll(): Promise<void> {
		const result = await this.git(["add", "-A"])
		if (result.code !== 0) {
			log.warn("stageAll failed", { stderr: result.stderr })
		}
	}

	// ─── Core Operations ─────────────────────────────────────────

	/** Capture current filesystem state. Returns tree hash, or undefined on failure. */
	async capture(): Promise<string | undefined> {
		try {
			await this.stageAll()
			const result = await this.git(["write-tree"])
			return result.stdout.trim() || undefined
		} catch {
			return undefined
		}
	}

	/**
	 * Get changed files between two tree hashes.
	 * @returns List of changed file paths (relative to repo root)
	 */
	async changedFiles(fromHash: string, toHash: string): Promise<string[]> {
		try {
			const result = await this.git([
				"diff-tree",
				"--no-commit-id",
				"--name-only",
				"-r",
				fromHash,
				toHash,
			])
			return result.stdout.trim().split("\n").filter(Boolean)
		} catch {
			return []
		}
	}

	/**
	 * Get per-file diff statistics between two tree hashes.
	 * Returns additions, deletions, and status for each changed file.
	 */
	async diffStats(fromHash: string, toHash: string): Promise<FileDiff[]> {
		try {
			// Get file statuses (A/D/M)
			const statusResult = await this.git([
				"diff-tree",
				"--no-commit-id",
				"--name-status",
				"--no-renames",
				"-r",
				fromHash,
				toHash,
			])
			const statusMap = new Map<string, "added" | "deleted" | "modified">()
			for (const line of statusResult.stdout.trim().split("\n")) {
				if (!line) continue
				const [code, file] = line.split("\t")
				if (!code || !file) continue
				statusMap.set(
					file,
					code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified",
				)
			}

			// Get numeric stats
			const numstatResult = await this.git([
				"diff-tree",
				"--no-commit-id",
				"--numstat",
				"--no-renames",
				"-r",
				fromHash,
				toHash,
			])
			const results: FileDiff[] = []
			for (const line of numstatResult.stdout.trim().split("\n")) {
				if (!line) continue
				const [adds, dels, file] = line.split("\t")
				if (!file) continue
				const binary = adds === "-" && dels === "-"
				const additions = binary ? 0 : Number.parseInt(adds!)
				const deletions = binary ? 0 : Number.parseInt(dels!)
				results.push({
					path: file,
					additions: Number.isFinite(additions) ? additions : 0,
					deletions: Number.isFinite(deletions) ? deletions : 0,
					status: statusMap.get(file) ?? "modified",
				})
			}
			return results
		} catch (err) {
			log.warn("diffStats failed", { error: String(err) })
			return []
		}
	}

	/**
	 * Get changed files since a snapshot hash (comparing index to hash).
	 * Returns patch data for use with revert().
	 */
	async patch(hash: string): Promise<SnapshotPatch> {
		try {
			await this.stageAll()
			const result = await this.git(["diff", "--no-ext-diff", "--name-only", hash, "--", "."])
			if (result.code !== 0) {
				log.warn("patch failed", { hash, stderr: result.stderr })
				return { hash, files: [] }
			}
			const files = result.stdout
				.trim()
				.split("\n")
				.map((f) => f.trim())
				.filter(Boolean)
				.map((f) => join(this.directory, f))
			return { hash, files }
		} catch {
			return { hash, files: [] }
		}
	}

	/**
	 * Revert per-file changes. For each file in each patch, restores it
	 * to its state at the patch's snapshot hash. If the file didn't exist
	 * in the snapshot, deletes it. Deduplicates across patches.
	 */
	async revert(patches: SnapshotPatch[]): Promise<void> {
		const seen = new Set<string>()
		for (const item of patches) {
			for (const file of item.files) {
				if (seen.has(file)) continue
				seen.add(file)
				log.info("reverting", { file, hash: item.hash })

				const result = await this.git(["checkout", item.hash, "--", file])
				if (result.code !== 0) {
					// Check if file existed in the snapshot
					const rel = relative(this.directory, file)
					const tree = await this.git(["ls-tree", item.hash, "--", rel])
					if (tree.code === 0 && tree.stdout.trim()) {
						log.info("file existed in snapshot but checkout failed, keeping", { file })
					} else {
						log.info("file did not exist in snapshot, deleting", { file })
						try {
							const { unlink } = await import("node:fs/promises")
							await unlink(file)
						} catch {
							// File may already be gone
						}
					}
				}
			}
		}
	}

	/**
	 * Full tree restore for unrevert: sets index to target hash
	 * and force-checks out all files.
	 */
	async restore(hash: string): Promise<void> {
		log.info("restore", { hash })
		const readTree = await this.git(["read-tree", hash])
		if (readTree.code !== 0) {
			log.error("failed to read-tree for restore", { hash, stderr: readTree.stderr })
			return
		}
		const checkout = await this.git(["checkout-index", "-a", "-f"])
		if (checkout.code !== 0) {
			log.error("failed to checkout-index for restore", { hash, stderr: checkout.stderr })
		}
	}

	async dispose(): Promise<void> {}
}

/** Per-workspace snapshot manager. Lazy-initialized. */
export const snapshot = Workspace.lazy(
	async () => SnapshotManager.init(Workspace.dir()),
	async (s) => await s.dispose(),
)

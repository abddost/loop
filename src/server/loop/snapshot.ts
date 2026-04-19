import { mkdir, stat, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"
import type { FileDiff } from "@core/schema/part"
import type { Project } from "@core/schema/project"
import { env } from "../env"
import { createLogger } from "../logger"
import { Workspace } from "../workspace"

const log = createLogger("snapshot")

const PRUNE_WINDOW = "7.days"
const PRUNE_INTERVAL_MS = 60 * 60 * 1000
const PRUNE_INITIAL_DELAY_MS = 60 * 1000

const CORE = ["-c", "core.longpaths=true", "-c", "core.symlinks=true"]
const CFG = ["-c", "core.autocrlf=false", ...CORE]
const QUOTE = [...CFG, "-c", "core.quotepath=false"]

export interface SnapshotPatch {
	hash: string
	files: string[]
}

/** Unified diff for a single file between two snapshot tree hashes. */
export interface FileDiffContent {
	path: string
	/** Unified diff text from `git diff` (empty for binary files). */
	diff: string
	additions: number
	deletions: number
	status: "added" | "deleted" | "modified"
	binary: boolean
}

interface GitResult {
	code: number
	stdout: string
	stderr: string
}

/**
 * Shadow-git snapshot manager.
 *
 * Captures the workspace's file state into an isolated git repository at
 * `${dataDir}/snapshot/<projectId>`. The user's real `.git` is never touched —
 * all commands run with `--git-dir <shadow> --work-tree <userdir>`. The shadow
 * is always on regardless of whether the user's worktree is itself a git repo.
 *
 * Lifecycle: created lazily via Workspace.lazy, disposed when the workspace is
 * torn down. The background prune loop is tied to that lifecycle.
 */
class SnapshotManager {
	/** Serializes stageAll + write-tree; protects the shadow index. */
	private lock: Promise<void> = Promise.resolve()
	private pruneInitialTimer: NodeJS.Timeout | undefined
	private pruneIntervalTimer: NodeJS.Timeout | undefined
	/** Sticky disable if git is not installed or the shadow repo is unusable. */
	private disabled = false

	private constructor(
		/** User's workspace/worktree root. Target of `--work-tree`. */
		readonly worktree: string,
		/** Shadow git directory, inside `dataDir/snapshot/<projectId>`. Target of `--git-dir`. */
		readonly gitdir: string,
	) {}

	static async init(opts: { worktree: string; project: Project }): Promise<SnapshotManager> {
		// The shadow git is always on. It does not require the worktree itself
		// to be a git repo — we supply our own --git-dir and --work-tree. This
		// also sidesteps stale Workspace.project.vcs caching when the user runs
		// `git init` while the server is already up.
		const gitdir = join(env.dataDir, "snapshot", opts.project.id)
		const mgr = new SnapshotManager(opts.worktree, gitdir)
		mgr.schedulePrune()
		log.info("snapshot manager init", { gitdir, worktree: opts.worktree })
		return mgr
	}

	// ─── Low-level git plumbing ────────────────────────────────

	/** Wraps args in `--git-dir <shadow> --work-tree <worktree>`. */
	private args(cmd: string[]): string[] {
		return ["--git-dir", this.gitdir, "--work-tree", this.worktree, ...cmd]
	}

	private async git(
		args: string[],
		opts?: { cwd?: string; env?: Record<string, string> },
	): Promise<GitResult> {
		try {
			const proc = Bun.spawn(["git", ...args], {
				cwd: opts?.cwd ?? this.worktree,
				env: opts?.env ? { ...process.env, ...opts.env } : undefined,
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
			// Most likely ENOENT (git not installed) — disable for the rest of the lifetime.
			this.disabled = true
			log.warn("git spawn failed; snapshot disabled", { error: String(err) })
			return { code: 1, stdout: "", stderr: String(err) }
		}
	}

	private async withLock<T>(fn: () => Promise<T>): Promise<T> {
		const prev = this.lock
		let release!: () => void
		this.lock = new Promise((r) => {
			release = r
		})
		await prev
		try {
			return await fn()
		} finally {
			release()
		}
	}

	// ─── Init / exclude sync ───────────────────────────────────

	private async exists(path: string): Promise<boolean> {
		try {
			await stat(path)
			return true
		} catch {
			return false
		}
	}

	/** Lazy-create the shadow repo on first use. */
	private async ensureInit(): Promise<boolean> {
		if (this.disabled) return false
		const existed = await this.exists(this.gitdir)
		try {
			await mkdir(this.gitdir, { recursive: true })
		} catch (err) {
			log.warn("failed to create shadow gitdir", { gitdir: this.gitdir, error: String(err) })
			this.disabled = true
			return false
		}
		if (existed) return true
		// Use env vars (matching opencode) so `git init` targets the shadow path
		// instead of creating a .git directory inside the user's worktree.
		const initResult = await this.git(["init"], {
			env: { GIT_DIR: this.gitdir, GIT_WORK_TREE: this.worktree },
		})
		if (initResult.code !== 0) {
			log.warn("git init failed", { stderr: initResult.stderr })
			this.disabled = true
			return false
		}
		// Quiet git's picky defaults. Match opencode's config exactly.
		for (const [k, v] of [
			["core.autocrlf", "false"],
			["core.longpaths", "true"],
			["core.symlinks", "true"],
			["core.fsmonitor", "false"],
		] as const) {
			await this.git(["--git-dir", this.gitdir, "config", k, v])
		}
		log.info("shadow repo initialized", { gitdir: this.gitdir })
		return true
	}

	/**
	 * Resolve and copy the user's real `.git/info/exclude` into the shadow's
	 * `info/exclude`. Ensures `.gitignore` / exclude rules are respected during
	 * `git add .` in the shadow.
	 */
	private async syncExcludes(): Promise<void> {
		// Ask the user's real repo where its info/exclude lives.
		const result = await this.git(
			["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"],
			{ cwd: this.worktree },
		)
		const target = join(this.gitdir, "info", "exclude")
		try {
			await mkdir(join(this.gitdir, "info"), { recursive: true })
		} catch {
			// ignore — next write will surface any real error
		}
		const source = result.stdout.trim()
		if (!source || !(await this.exists(source))) {
			await writeFile(target, "").catch(() => {})
			return
		}
		try {
			const contents = await Bun.file(source).text()
			await writeFile(target, contents)
		} catch {
			// Best-effort — don't fail capture on exclude sync issues.
			await writeFile(target, "").catch(() => {})
		}
	}

	/** syncExcludes + `git add .`. Mutates only the shadow's index. */
	private async stageAll(): Promise<void> {
		await this.syncExcludes()
		const result = await this.git([...CFG, ...this.args(["add", "."])], { cwd: this.worktree })
		if (result.code !== 0) {
			log.warn("stageAll failed", { stderr: result.stderr })
		}
	}

	// ─── Public API ────────────────────────────────────────────

	/**
	 * Capture current filesystem state as a tree hash. Returns undefined if the
	 * manager is disabled, the repo init fails, or `write-tree` returns empty.
	 * Serialized via lock to keep stageAll and write-tree coupled.
	 */
	async capture(): Promise<string | undefined> {
		if (this.disabled) return undefined
		return this.withLock(async () => {
			if (!(await this.ensureInit())) return undefined
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					await this.stageAll()
					const result = await this.git(this.args(["write-tree"]), { cwd: this.worktree })
					const hash = result.stdout.trim()
					if (hash) return hash
					if (attempt === 0) {
						log.warn("capture: write-tree empty, retrying", { attempt })
						await Bun.sleep(100)
					}
				} catch (err) {
					log.warn("capture failed", { attempt, error: String(err) })
					if (attempt === 0) await Bun.sleep(100)
				}
			}
			log.error("capture: all attempts failed")
			return undefined
		})
	}

	/** Changed file paths between two tree hashes (relative to worktree). */
	async changedFiles(fromHash: string, toHash: string): Promise<string[]> {
		if (this.disabled) return []
		const result = await this.git(
			[
				...QUOTE,
				...this.args([
					"diff-tree",
					"--no-commit-id",
					"--name-only",
					"--no-renames",
					"-r",
					fromHash,
					toHash,
				]),
			],
			{ cwd: this.worktree },
		)
		if (result.code !== 0) return []
		return result.stdout.trim().split("\n").filter(Boolean)
	}

	/**
	 * Per-file stats between two tree hashes. Cheap — no file content.
	 * Preserves the return shape used by stream-processor to build EditParts.
	 */
	async diffStats(fromHash: string, toHash: string): Promise<FileDiff[]> {
		if (this.disabled) return []
		try {
			const statusResult = await this.git(
				[
					...QUOTE,
					...this.args([
						"diff-tree",
						"--no-commit-id",
						"--name-status",
						"--no-renames",
						"-r",
						fromHash,
						toHash,
					]),
				],
				{ cwd: this.worktree },
			)
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
			const numstatResult = await this.git(
				[
					...QUOTE,
					...this.args([
						"diff-tree",
						"--no-commit-id",
						"--numstat",
						"--no-renames",
						"-r",
						fromHash,
						toHash,
					]),
				],
				{ cwd: this.worktree },
			)
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
			log.error("diffStats failed", { fromHash, toHash, error: String(err) })
			return []
		}
	}

	/**
	 * Full structured diff between two tree hashes, including before/after file
	 * content (for text files) so the UI can render unified diffs without
	 * additional round trips. Binary files are returned with empty strings and
	 * `binary: true`.
	 */
	async diffFull(fromHash: string, toHash: string): Promise<FileDiffContent[]> {
		if (this.disabled) return []
		if (fromHash === toHash) return []
		const statusMap = new Map<string, "added" | "deleted" | "modified">()
		const statuses = await this.git(
			[
				...QUOTE,
				...this.args([
					"diff",
					"--no-ext-diff",
					"--name-status",
					"--no-renames",
					fromHash,
					toHash,
					"--",
					".",
				]),
			],
			{ cwd: this.worktree },
		)
		if (statuses.code !== 0) {
			log.warn("diffFull: name-status failed", {
				fromHash,
				toHash,
				stderr: statuses.stderr,
			})
			return []
		}
		for (const line of statuses.stdout.trim().split("\n")) {
			if (!line) continue
			const [code, file] = line.split("\t")
			if (!code || !file) continue
			statusMap.set(
				file,
				code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified",
			)
		}

		const numstat = await this.git(
			[
				...QUOTE,
				...this.args([
					"diff",
					"--no-ext-diff",
					"--no-renames",
					"--numstat",
					fromHash,
					toHash,
					"--",
					".",
				]),
			],
			{ cwd: this.worktree },
		)
		if (numstat.code !== 0) {
			log.warn("diffFull: numstat failed", { fromHash, toHash, stderr: numstat.stderr })
			return []
		}

		const result: FileDiffContent[] = []
		const lines = numstat.stdout.trim().split("\n").filter(Boolean)
		// Fetch per-file unified diffs in parallel, bounded concurrency.
		const CONCURRENCY = 8
		const fetchContent = async (line: string): Promise<FileDiffContent | null> => {
			const [adds, dels, rawFile] = line.split("\t")
			if (!rawFile) return null
			const file = rawFile.replaceAll("\\", "/")
			const binary = adds === "-" && dels === "-"
			const additions = binary ? 0 : Number.parseInt(adds!)
			const deletions = binary ? 0 : Number.parseInt(dels!)
			const status = statusMap.get(rawFile) ?? "modified"
			if (binary) {
				return { path: file, diff: "", additions: 0, deletions: 0, status, binary: true }
			}
			const diffResult = await this.git(
				[...QUOTE, ...this.args(["diff", "--no-ext-diff", fromHash, toHash, "--", rawFile])],
				{ cwd: this.worktree },
			)
			return {
				path: file,
				diff: diffResult.code === 0 ? diffResult.stdout : "",
				additions: Number.isFinite(additions) ? additions : 0,
				deletions: Number.isFinite(deletions) ? deletions : 0,
				status,
				binary: false,
			}
		}

		for (let i = 0; i < lines.length; i += CONCURRENCY) {
			const chunk = lines.slice(i, i + CONCURRENCY)
			const contents = await Promise.all(chunk.map(fetchContent))
			for (const c of contents) if (c) result.push(c)
		}
		return result
	}

	/** Files changed between a tree hash and the current (staged) worktree. */
	async patch(hash: string): Promise<SnapshotPatch> {
		if (this.disabled) return { hash, files: [] }
		return this.withLock(async () => {
			try {
				if (!(await this.ensureInit())) return { hash, files: [] }
				await this.stageAll()
				const result = await this.git(
					[...QUOTE, ...this.args(["diff", "--no-ext-diff", "--name-only", hash, "--", "."])],
					{ cwd: this.worktree },
				)
				if (result.code !== 0) {
					log.warn("patch failed", { hash, stderr: result.stderr })
					return { hash, files: [] }
				}
				const files = result.stdout
					.trim()
					.split("\n")
					.map((f) => f.trim())
					.filter(Boolean)
					.map((f) => join(this.worktree, f).replaceAll("\\", "/"))
				return { hash, files }
			} catch {
				return { hash, files: [] }
			}
		})
	}

	/**
	 * Revert per-file changes. For each file in each patch, restores it to its
	 * state at the patch's snapshot hash. If the file didn't exist in the
	 * snapshot, deletes it. Deduplicates across patches.
	 */
	async revert(patches: SnapshotPatch[]): Promise<void> {
		if (this.disabled) return
		const seen = new Set<string>()
		for (const item of patches) {
			for (const file of item.files) {
				if (seen.has(file)) continue
				seen.add(file)
				log.info("reverting", { file, hash: item.hash })
				const result = await this.git(
					[...CORE, ...this.args(["checkout", item.hash, "--", file])],
					{ cwd: this.worktree },
				)
				if (result.code !== 0) {
					const rel = relative(this.worktree, file)
					const tree = await this.git([...CORE, ...this.args(["ls-tree", item.hash, "--", rel])], {
						cwd: this.worktree,
					})
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
	 * Full tree restore: sets the shadow index to the target tree and then
	 * writes every file out to the user's worktree. Used for unrevert.
	 */
	async restore(hash: string): Promise<void> {
		if (this.disabled) return
		log.info("restore", { hash })
		const readTree = await this.git([...CORE, ...this.args(["read-tree", hash])], {
			cwd: this.worktree,
		})
		if (readTree.code !== 0) {
			log.error("failed to read-tree for restore", { hash, stderr: readTree.stderr })
			return
		}
		const checkout = await this.git([...CORE, ...this.args(["checkout-index", "-a", "-f"])], {
			cwd: this.worktree,
		})
		if (checkout.code !== 0) {
			log.error("failed to checkout-index for restore", { hash, stderr: checkout.stderr })
		}
	}

	// ─── Pruning ──────────────────────────────────────────────

	/** `git gc --prune=7.days` — drops loose objects older than the window. */
	async cleanup(): Promise<void> {
		if (this.disabled) return
		if (!(await this.exists(this.gitdir))) return
		const result = await this.git(this.args(["gc", `--prune=${PRUNE_WINDOW}`]), {
			cwd: this.worktree,
		})
		if (result.code !== 0) {
			log.warn("cleanup failed", { exitCode: result.code, stderr: result.stderr })
			return
		}
		log.info("cleanup", { prune: PRUNE_WINDOW })
	}

	/** First tick after 1 minute, then every 1 hour. Matches opencode cadence. */
	private schedulePrune(): void {
		this.pruneInitialTimer = setTimeout(() => {
			this.pruneInitialTimer = undefined
			void this.cleanup().catch((err) => log.warn("prune tick failed", { error: String(err) }))
			this.pruneIntervalTimer = setInterval(() => {
				void this.cleanup().catch((err) => log.warn("prune tick failed", { error: String(err) }))
			}, PRUNE_INTERVAL_MS)
			// Hourly ticks shouldn't keep the process alive on their own.
			this.pruneIntervalTimer.unref?.()
		}, PRUNE_INITIAL_DELAY_MS)
		this.pruneInitialTimer.unref?.()
	}

	async dispose(): Promise<void> {
		if (this.pruneInitialTimer) {
			clearTimeout(this.pruneInitialTimer)
			this.pruneInitialTimer = undefined
		}
		if (this.pruneIntervalTimer) {
			clearInterval(this.pruneIntervalTimer)
			this.pruneIntervalTimer = undefined
		}
	}
}

export type { SnapshotManager }

/** Per-workspace snapshot manager. Lazy-initialized. */
export const snapshot = Workspace.lazy(
	async () => {
		const project = Workspace.project()
		const worktree = project.worktree ?? Workspace.dir()
		return SnapshotManager.init({ worktree, project })
	},
	async (s) => await s.dispose(),
)

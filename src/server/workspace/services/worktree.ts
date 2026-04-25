import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { ulid } from "@core/id"
import type { Project } from "@core/schema/project"
import type { Sandbox } from "@core/schema/sandbox"
import * as Config from "../../config"
import {
	createSandbox,
	deleteSandbox,
	findAllSandboxes,
	findProjectById,
	findSandboxById,
	findSandboxesByProjectId,
	updateSandbox,
} from "../../db/queries"
import { env } from "../../env"
import { randomName } from "../../lib/name-generator"
import { createLogger } from "../../logger"
import { bootstrapWorkspace } from "../bootstrap"
import { bus } from "../bus"
import { Workspace } from "../index"

const log = createLogger("worktree")

/** Run a git command. Returns trimmed stdout and exit code. */
async function git(
	args: string[],
	cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		})
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		])
		const code = await proc.exited
		return { code, stdout: stdout.trim(), stderr: stderr.trim() }
	} catch (err) {
		return { code: 1, stdout: "", stderr: String(err) }
	}
}

/** Slug-ify a name: lowercase, replace non-alphanum with dash, collapse dashes. */
function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
}

interface WorktreeInfo {
	name: string
	branch: string
	directory: string
}

/**
 * Generate a unique worktree name, branch, and directory.
 * Branch pattern: loop/<name>
 * Directory: <dataDir>/worktree/<projectId>/<name>
 */
async function makeWorktreeInfo(
	projectId: string,
	repoDir: string,
	inputName?: string,
): Promise<WorktreeInfo> {
	const root = resolve(env.dataDir, "worktree", projectId)
	await mkdir(root, { recursive: true })

	const base = inputName ? slug(inputName) : ""

	for (let attempt = 0; attempt < 26; attempt++) {
		const name = base ? (attempt === 0 ? base : `${base}-${randomName()}`) : randomName()
		const branch = `loop/${name}`
		const directory = resolve(root, name)

		if (existsSync(directory)) continue

		// Check branch doesn't already exist
		const ref = `refs/heads/${branch}`
		const branchCheck = await git(["show-ref", "--verify", "--quiet", ref], repoDir)
		if (branchCheck.code === 0) continue

		return { name, branch, directory }
	}

	throw new Error("Failed to generate unique worktree name after 26 attempts")
}

/** Find the default remote branch (e.g. "main" or "master"). */
async function findDefaultBranch(repoDir: string): Promise<string> {
	// Try symbolic ref first
	const symbolic = await git(["symbolic-ref", "refs/remotes/origin/HEAD"], repoDir)
	if (symbolic.code === 0 && symbolic.stdout) {
		return symbolic.stdout.replace("refs/remotes/origin/", "")
	}

	// Fallback: check for main, then master
	for (const branch of ["main", "master"]) {
		const check = await git(["rev-parse", "--verify", `refs/heads/${branch}`], repoDir)
		if (check.code === 0) return branch
	}

	return "main"
}

class WorktreeService {
	/** Serializes create operations per project to prevent git lock contention. */
	private createLock: Promise<void> = Promise.resolve()

	constructor(
		readonly directory: string,
		readonly projectId: string,
	) {}

	static async init(directory: string, projectId: string): Promise<WorktreeService> {
		return new WorktreeService(directory, projectId)
	}

	/**
	 * Create a new git worktree.
	 * Returns the sandbox record immediately. Bootstrap runs asynchronously.
	 * Emits worktree:ready or worktree:failed via bus when bootstrap completes.
	 */
	async create(opts?: { name?: string }): Promise<Sandbox> {
		// Serialize creates to prevent git lock contention
		const prev = this.createLock
		let release!: () => void
		this.createLock = new Promise((r) => {
			release = r
		})
		await prev

		try {
			const info = await makeWorktreeInfo(this.projectId, this.directory, opts?.name)

			// Create the git worktree (fast, no checkout)
			const created = await git(
				["worktree", "add", "--no-checkout", "-b", info.branch, info.directory],
				this.directory,
			)
			if (created.code !== 0) {
				throw new Error(created.stderr || "Failed to create git worktree")
			}

			// Insert sandbox record
			const sandbox = createSandbox({
				id: ulid(),
				projectId: this.projectId,
				name: info.name,
				directory: info.directory,
				branch: info.branch,
				status: "creating",
			})

			const result = sandbox as Sandbox

			log.info("worktree created, starting bootstrap", {
				name: info.name,
				branch: info.branch,
				directory: info.directory,
			})

			// Async bootstrap — fire and forget, will emit events
			this.bootstrap(result)

			// Auto-prune old worktrees (fire and forget)
			pruneWorktrees().catch((err) =>
				log.warn("auto-prune failed", { error: err instanceof Error ? err.message : String(err) }),
			)

			return result
		} finally {
			release()
		}
	}

	/** Async bootstrap: populate files, init workspace, emit ready/failed. */
	private async bootstrap(sandbox: Sandbox): Promise<void> {
		try {
			// Populate files
			const populated = await git(["reset", "--hard"], sandbox.directory)
			if (populated.code !== 0) {
				throw new Error(populated.stderr || "git reset --hard failed")
			}

			// Initialize workspace context for the worktree directory and bootstrap
			// (bus, MCP, file watcher) in one atomic step.
			const projectId = this.projectId
			await Workspace.init(
				sandbox.directory,
				() => {
					const project = findProjectById(projectId)
					if (!project) throw new Error(`Project not found: ${projectId}`)
					return project as Project
				},
				() => bootstrapWorkspace(sandbox.directory),
			)

			// Mark ready
			updateSandbox(sandbox.id, { status: "ready" })

			log.info("worktree bootstrap complete", {
				name: sandbox.name,
				directory: sandbox.directory,
			})

			bus().emit("worktree:ready", {
				sandboxId: sandbox.id,
				worktreeDirectory: sandbox.directory,
				branch: sandbox.branch,
			})
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			log.error("worktree bootstrap failed", {
				name: sandbox.name,
				directory: sandbox.directory,
				error: message,
			})

			updateSandbox(sandbox.id, { status: "failed" })

			bus().emit("worktree:failed", {
				sandboxId: sandbox.id,
				worktreeDirectory: sandbox.directory,
				error: message,
			})
		}
	}

	/** Remove a worktree: dispose workspace, remove git worktree, delete branch, delete sandbox. */
	async remove(sandboxId: string): Promise<void> {
		const sandbox = findSandboxById(sandboxId)
		if (!sandbox) throw new Error(`Sandbox not found: ${sandboxId}`)

		updateSandbox(sandboxId, { status: "removing" })

		// Dispose workspace if initialized
		try {
			await Workspace.dispose(sandbox.directory)
		} catch {
			// May not be initialized
		}

		// Remove git worktree
		const removed = await git(["worktree", "remove", "--force", sandbox.directory], this.directory)
		if (removed.code !== 0) {
			log.warn("git worktree remove failed, cleaning up manually", {
				stderr: removed.stderr,
			})
		}

		// Force-remove directory if still exists
		if (existsSync(sandbox.directory)) {
			await rm(sandbox.directory, { recursive: true, force: true })
		}

		// Delete branch
		const branch = sandbox.branch
		if (branch) {
			const deleted = await git(["branch", "-D", branch], this.directory)
			if (deleted.code !== 0) {
				log.warn("branch delete failed", { branch, stderr: deleted.stderr })
			}
		}

		// Delete sandbox record
		deleteSandbox(sandboxId)

		log.info("worktree removed", { name: sandbox.name, directory: sandbox.directory })

		bus().emit("worktree:removed", { sandboxId })
	}

	/** Hard-reset a worktree to match the default branch. */
	async reset(sandboxId: string): Promise<void> {
		const sandbox = findSandboxById(sandboxId)
		if (!sandbox) throw new Error(`Sandbox not found: ${sandboxId}`)

		if (sandbox.directory === this.directory) {
			throw new Error("Cannot reset the primary workspace")
		}

		const defaultBranch = await findDefaultBranch(this.directory)

		// Fetch latest
		const fetched = await git(["fetch", "origin", defaultBranch], sandbox.directory)
		if (fetched.code !== 0) {
			log.warn("fetch failed during reset", { stderr: fetched.stderr })
		}

		// Hard reset
		const reset = await git(["reset", "--hard", `origin/${defaultBranch}`], sandbox.directory)
		if (reset.code !== 0) {
			throw new Error(reset.stderr || "git reset --hard failed")
		}

		// Clean untracked files
		const cleaned = await git(["clean", "-ffdx"], sandbox.directory)
		if (cleaned.code !== 0) {
			log.warn("git clean failed during reset", { stderr: cleaned.stderr })
		}

		log.info("worktree reset", { name: sandbox.name, defaultBranch })

		bus().emit("worktree:reset", { sandboxId })
	}

	/** List all sandboxes for the current project. Prunes stale entries. */
	async list(): Promise<Sandbox[]> {
		const sandboxes = findSandboxesByProjectId(this.projectId)

		// Prune sandboxes whose directories no longer exist
		const live: Sandbox[] = []
		for (const s of sandboxes) {
			if (s.status === "creating") {
				live.push(s as Sandbox)
			} else if (existsSync(s.directory)) {
				live.push(s as Sandbox)
			} else {
				log.info("pruning stale sandbox", { name: s.name, directory: s.directory })
				deleteSandbox(s.id)
			}
		}
		return live
	}

	async dispose(): Promise<void> {}
}

/** Per-workspace worktree service. Lazy-initialized. */
export const worktreeService = Workspace.lazy(
	async () => WorktreeService.init(Workspace.dir(), Workspace.project().id),
	async (w) => await w.dispose(),
)

// ─── Global Worktree Operations ─────────────────────────────

/**
 * Remove a sandbox by ID without requiring workspace context.
 * Used by the settings page for manual deletion.
 */
export async function removeSandboxGlobal(sandboxId: string): Promise<void> {
	const sandbox = findSandboxById(sandboxId)
	if (!sandbox) throw new Error(`Sandbox not found: ${sandboxId}`)

	// Find the project to get the main repo directory for git operations
	const project = findProjectById(sandbox.projectId)
	const repoDir = project?.directory ?? sandbox.directory

	updateSandbox(sandboxId, { status: "removing" })

	// Dispose workspace if initialized
	try {
		await Workspace.dispose(sandbox.directory)
	} catch {
		// May not be initialized
	}

	// Remove git worktree
	const removed = await git(["worktree", "remove", "--force", sandbox.directory], repoDir)
	if (removed.code !== 0) {
		log.warn("git worktree remove failed, cleaning up manually", {
			stderr: removed.stderr,
		})
	}

	// Force-remove directory if still exists
	if (existsSync(sandbox.directory)) {
		await rm(sandbox.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
	}

	// Delete branch
	if (sandbox.branch) {
		const deleted = await git(["branch", "-D", sandbox.branch], repoDir)
		if (deleted.code !== 0) {
			log.warn("branch delete failed", { branch: sandbox.branch, stderr: deleted.stderr })
		}
	}

	// Delete sandbox record
	deleteSandbox(sandboxId)

	log.info("worktree removed (global)", { name: sandbox.name, directory: sandbox.directory })
}

/**
 * Auto-prune old worktrees beyond the configured keep limit.
 * Keeps the N most recent worktrees (globally, by creation time).
 * Skips worktrees in transitional states (creating, removing).
 */
export async function pruneWorktrees(): Promise<number> {
	const config = Config.read()
	const limit = config.worktree.autoDeleteLimit

	// All sandboxes ordered newest-first
	const all = findAllSandboxes()

	// Only consider stable sandboxes for pruning (ready or failed)
	const prunable = all.filter((s) => s.status === "ready" || s.status === "failed")

	if (prunable.length <= limit) return 0

	// The ones beyond the limit (oldest)
	const toDelete = prunable.slice(limit)

	let pruned = 0
	for (const sandbox of toDelete) {
		try {
			await removeSandboxGlobal(sandbox.id)
			pruned++
		} catch (err) {
			log.error("failed to prune worktree", {
				name: sandbox.name,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	if (pruned > 0) {
		log.info("auto-pruned worktrees", { pruned, limit })
	}

	return pruned
}

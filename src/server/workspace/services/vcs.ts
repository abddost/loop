import { resolve } from "node:path"
import { Workspace } from "../index"

export interface GitChange {
	path: string
	oldPath?: string
	status: "new" | "modified" | "deleted" | "renamed" | "untracked"
	staged: boolean
	additions: number
	deletions: number
}

export interface BranchInfo {
	current: string | null
	local: string[]
	remote: string[]
}

export interface CommitResult {
	hash: string
	message: string
}

/** Production-grade VCS service — provides git operations for a workspace. */
class VCSService {
	constructor(readonly directory: string) {}

	static async init(directory: string): Promise<VCSService> {
		return new VCSService(directory)
	}

	// ── Read operations ─────────────────────────────────────────────

	async getBranch(): Promise<{
		branch: string | null
		dirty: boolean
		ahead: number
		behind: number
	}> {
		const isGit = await this.exec("git", "rev-parse", "--is-inside-work-tree").catch(() => null)
		if (isGit !== "true") {
			return { branch: null, dirty: false, ahead: 0, behind: 0 }
		}

		const [branch, status] = await Promise.all([
			this.exec("git", "rev-parse", "--abbrev-ref", "HEAD").catch(() => null),
			this.exec("git", "status", "--porcelain").catch(() => ""),
		])

		let ahead = 0
		let behind = 0
		try {
			const counts = await this.exec(
				"git",
				"rev-list",
				"--left-right",
				"--count",
				"HEAD...@{upstream}",
			)
			const [a, b] = counts.split("\t").map(Number)
			ahead = a ?? 0
			behind = b ?? 0
		} catch {
			// No upstream configured
		}

		return { branch: branch || "HEAD", dirty: status.length > 0, ahead, behind }
	}

	async getStatus(): Promise<GitChange[]> {
		const raw = await this.exec("git", "status", "--porcelain").catch(() => "")
		if (!raw) return []

		const changes = new Map<string, GitChange>()

		for (const line of raw.split("\n")) {
			if (!line) continue
			const indexStatus = line[0]!
			const worktreeStatus = line[1]!
			let filePath = line.slice(3)

			let status: GitChange["status"]
			let staged: boolean
			let oldPath: string | undefined

			if (indexStatus === "?" && worktreeStatus === "?") {
				status = "untracked"
				staged = false
			} else if (indexStatus === "R") {
				status = "renamed"
				staged = true
				const parts = filePath.split(" -> ")
				oldPath = parts[0]
				filePath = parts[1]!
			} else {
				const effectiveChar = indexStatus !== " " ? indexStatus : worktreeStatus
				staged = indexStatus !== " " && indexStatus !== "?"

				switch (effectiveChar) {
					case "A":
						status = "new"
						break
					case "D":
						status = "deleted"
						break
					case "M":
						status = "modified"
						break
					default:
						status = "modified"
				}
			}

			changes.set(filePath, {
				path: filePath,
				oldPath,
				status,
				staged,
				additions: 0,
				deletions: 0,
			})
		}

		// Merge numstat counts from unstaged and staged diffs
		const [unstaged, staged] = await Promise.all([
			this.exec("git", "diff", "--numstat").catch(() => ""),
			this.exec("git", "diff", "--cached", "--numstat").catch(() => ""),
		])

		for (const numstatOutput of [unstaged, staged]) {
			if (!numstatOutput) continue
			for (const line of numstatOutput.split("\n")) {
				if (!line) continue
				const parts = line.split("\t")
				if (parts.length < 3) continue
				const additions = Number.parseInt(parts[0]!, 10) || 0
				const deletions = Number.parseInt(parts[1]!, 10) || 0
				const filePath = parts[2]!
				const entry = changes.get(filePath)
				if (entry) {
					entry.additions += additions
					entry.deletions += deletions
				}
			}
		}

		// For untracked files with zero stats, count lines as additions
		for (const entry of changes.values()) {
			if (entry.status === "untracked" && entry.additions === 0) {
				try {
					const content = await Bun.file(resolve(this.directory, entry.path)).text()
					entry.additions = content.split("\n").length
				} catch {
					// File may have been deleted between status and read
				}
			}
		}

		return Array.from(changes.values())
	}

	async getDiff(
		path: string,
		cached?: boolean,
	): Promise<{ diff: string; additions: number; deletions: number }> {
		// Try the requested diff type first
		let diff = ""

		if (cached) {
			diff = await this.exec("git", "diff", "--cached", "--", path).catch(() => "")
		} else {
			// Try unstaged diff first
			diff = await this.exec("git", "diff", "--", path).catch(() => "")

			// If empty, try staged diff (file may be staged only)
			if (!diff) {
				diff = await this.exec("git", "diff", "--cached", "--", path).catch(() => "")
			}

			// If still empty, check if file is untracked — generate pseudo-diff
			if (!diff) {
				const tracked = await this.exec("git", "ls-files", "--", path).catch(() => "")
				if (!tracked) {
					diff = await this.generateUntrackedDiff(path)
				}
			}
		}

		let additions = 0
		let deletions = 0
		for (const line of diff.split("\n")) {
			if (line.startsWith("+") && !line.startsWith("+++")) additions++
			else if (line.startsWith("-") && !line.startsWith("---")) deletions++
		}

		return { diff, additions, deletions }
	}

	/** Generate a pseudo unified-diff for an untracked file (full content as additions). */
	private async generateUntrackedDiff(path: string): Promise<string> {
		try {
			const content = await Bun.file(resolve(this.directory, path)).text()
			const lines = content.split("\n")
			// Remove trailing empty line if present
			if (lines.length > 0 && lines[lines.length - 1] === "") {
				lines.pop()
			}
			const addedLines = lines.map((l) => `+${l}`).join("\n")
			return `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${addedLines}`
		} catch {
			return ""
		}
	}

	// ── Branch operations ───────────────────────────────────────────

	async listBranches(): Promise<BranchInfo> {
		const isGit = await this.exec("git", "rev-parse", "--is-inside-work-tree").catch(() => null)
		if (isGit !== "true") {
			return { current: null, local: [], remote: [] }
		}

		const [currentRaw, localRaw, remoteRaw] = await Promise.all([
			this.exec("git", "rev-parse", "--abbrev-ref", "HEAD").catch(() => null),
			this.exec("git", "branch", "--format=%(refname:short)").catch(() => ""),
			this.exec("git", "branch", "-r", "--format=%(refname:short)").catch(() => ""),
		])

		const current = currentRaw || null
		const local = localRaw
			.split("\n")
			.map((b) => b.trim())
			.filter(Boolean)
		const remote = remoteRaw
			.split("\n")
			.map((b) => b.trim())
			.filter((b) => b && !b.includes("HEAD"))

		return { current, local, remote }
	}

	async switchBranch(branch: string): Promise<void> {
		// Ensure clean working tree or handle gracefully
		await this.exec("git", "checkout", branch)
	}

	async createBranch(name: string, checkout = true): Promise<void> {
		if (checkout) {
			await this.exec("git", "checkout", "-b", name)
		} else {
			await this.exec("git", "branch", name)
		}
	}

	// ── Staging operations ──────────────────────────────────────────

	async stageFile(path: string): Promise<void> {
		await this.exec("git", "add", "--", path)
	}

	async unstageFile(path: string): Promise<void> {
		// git reset HEAD works for both modified and new files
		await this.exec("git", "reset", "HEAD", "--", path).catch(async () => {
			// If HEAD doesn't exist (initial commit), use rm --cached
			await this.exec("git", "rm", "--cached", "--", path)
		})
	}

	async stageAll(): Promise<void> {
		await this.exec("git", "add", "-A")
	}

	async unstageAll(): Promise<void> {
		await this.exec("git", "reset", "HEAD").catch(async () => {
			// Initial commit — no HEAD yet
			await this.exec("git", "rm", "-r", "--cached", ".")
		})
	}

	// ── Commit & push ───────────────────────────────────────────────

	async commit(message: string): Promise<CommitResult> {
		await this.exec("git", "commit", "-m", message)
		const hash = await this.exec("git", "rev-parse", "--short", "HEAD").catch(() => "unknown")
		return { hash, message }
	}

	async push(remote = "origin", branch?: string, setUpstream = false): Promise<void> {
		const args = ["git", "push"]
		if (setUpstream) args.push("-u")
		args.push(remote)
		if (branch) args.push(branch)
		await this.exec(...args)
	}

	// ── Revert / discard ────────────────────────────────────────────

	async revertFile(path: string): Promise<void> {
		// Check if file exists in HEAD (has been committed before)
		const inHead = await this.exec("git", "cat-file", "-e", `HEAD:${path}`)
			.then(() => true)
			.catch(() => false)

		if (inHead) {
			// File exists in HEAD — restore both index and working tree to HEAD version
			// This handles: staged-modified, unstaged-modified, and combinations
			await this.exec("git", "checkout", "HEAD", "--", path)
		} else {
			// File doesn't exist in HEAD — it's either staged-new or untracked
			// Remove from staging area if staged
			await this.exec("git", "rm", "--cached", "-f", "--", path).catch(() => {})
			// Delete the working tree file
			const filePath = resolve(this.directory, path)
			try {
				await Bun.file(filePath)
					.exists()
					.then(async (exists) => {
						if (exists) {
							const { unlink } = await import("node:fs/promises")
							await unlink(filePath)
						}
					})
			} catch {
				// File may already be gone
			}
		}
	}

	// ── Internal ────────────────────────────────────────────────────

	private async exec(...args: string[]): Promise<string> {
		const proc = Bun.spawn(args, {
			cwd: this.directory,
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		})
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		])
		const exitCode = await proc.exited
		if (exitCode !== 0) {
			throw new Error(stderr.trim() || `git command failed with exit code ${exitCode}`)
		}
		return stdout.trim()
	}

	async dispose(): Promise<void> {}
}

/** Lazy-initialized VCS service for the current workspace. */
export const vcs = Workspace.lazy(
	async () => VCSService.init(Workspace.dir()),
	async (v) => await v.dispose(),
)

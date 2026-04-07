import { dirname, resolve } from "node:path"

export interface GitIdentity {
	/** Absolute path to the common .git directory (shared across worktrees). */
	commonDir: string
	/** Absolute path to the checkout root (git show-toplevel). */
	topLevel: string
	/** Whether this directory is inside a linked worktree (not the main checkout). */
	isWorktree: boolean
}

/** Run a git command and return trimmed stdout, or null on failure. */
async function git(args: string[], cwd: string): Promise<string | null> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		})
		const stdout = await new Response(proc.stdout).text()
		const code = await proc.exited
		if (code !== 0) return null
		return stdout.trim()
	} catch {
		return null
	}
}

/**
 * Resolve the canonical git identity for a directory.
 * Returns null if the directory is not inside a git repo.
 *
 * Uses `git rev-parse --git-common-dir` to find the shared .git dir
 * (same for main checkout and all linked worktrees), and
 * `git rev-parse --show-toplevel` to find the checkout root.
 */
export async function resolveGitIdentity(directory: string): Promise<GitIdentity | null> {
	const isGit = await git(["rev-parse", "--is-inside-work-tree"], directory)
	if (isGit !== "true") return null

	const [commonDirRaw, topLevel] = await Promise.all([
		git(["rev-parse", "--git-common-dir"], directory),
		git(["rev-parse", "--show-toplevel"], directory),
	])

	if (!commonDirRaw || !topLevel) return null

	// --git-common-dir may return a relative path; resolve it against cwd
	const commonDir = resolve(directory, commonDirRaw)

	// The main checkout's .git is at <topLevel>/.git
	// A linked worktree's .git file points to <main>/.git/worktrees/<name>
	// In both cases, --git-common-dir resolves to <main>/.git
	const mainRepoRoot = dirname(commonDir)
	const isWorktree = topLevel !== mainRepoRoot

	return { commonDir, topLevel, isWorktree }
}

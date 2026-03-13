import { Workspace } from "../index"

/** Placeholder VCS service — provides git status and branch info for a workspace. */
class VCSService {
	constructor(readonly directory: string) {}

	static async init(directory: string): Promise<VCSService> {
		return new VCSService(directory)
	}

	async getBranch(): Promise<{
		branch: string | null
		dirty: boolean
		ahead: number
		behind: number
	}> {
		// Check if directory is a git repository
		const isGit = await this.exec("git", "rev-parse", "--is-inside-work-tree").catch(() => null)
		if (isGit !== "true") {
			return { branch: null, dirty: false, ahead: 0, behind: 0 }
		}

		const branch = await this.exec("git", "rev-parse", "--abbrev-ref", "HEAD").catch(() => null)
		const status = await this.exec("git", "status", "--porcelain").catch(() => "")
		const dirty = status.length > 0

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

		return { branch: branch || "HEAD", dirty, ahead, behind }
	}

	private async exec(...args: string[]): Promise<string> {
		try {
			const proc = Bun.spawn(args, {
				cwd: this.directory,
				stdout: "pipe",
				stderr: "pipe",
			})
			const output = await new Response(proc.stdout).text()
			return output.trim()
		} catch {
			throw new Error(`Failed to execute: ${args.join(" ")}`)
		}
	}

	async dispose(): Promise<void> {}
}

/** Lazy-initialized VCS service for the current workspace. */
export const vcs = Workspace.lazy(
	async () => VCSService.init(Workspace.dir()),
	async (v) => await v.dispose(),
)

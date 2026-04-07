import { basename } from "node:path"
import { ulid } from "@core/id"
import type { Project } from "@core/schema/project"
import { createMiddleware } from "hono/factory"
import {
	findProjectByDirectory,
	findProjectByGitCommonDir,
	findSandboxByDirectory,
	upsertProject,
} from "../db/queries"
import { Workspace } from "../workspace"
import { bootstrapWorkspace } from "../workspace/bootstrap"
import { resolveGitIdentity } from "../workspace/services/git-identity"

/** Cache git identity resolution so we don't shell out on every request. */
const gitIdentityCache = new Map<string, Awaited<ReturnType<typeof resolveGitIdentity>>>()

/**
 * Resolve an existing project by directory or create a new one.
 * Uses git identity to ensure all worktrees of the same repo share one project.
 */
async function resolveOrCreateProject(directory: string): Promise<Project> {
	// Fast path: exact directory match
	const existing = findProjectByDirectory(directory)
	if (existing) {
		// Backfill git identity for projects created before worktree support
		if (!existing.gitCommonDir) {
			let gitIdentity = gitIdentityCache.get(directory)
			if (gitIdentity === undefined) {
				gitIdentity = await resolveGitIdentity(directory)
				gitIdentityCache.set(directory, gitIdentity)
			}
			if (gitIdentity) {
				return upsertProject({
					id: existing.id,
					name: existing.name,
					directory: existing.directory,
					worktree: gitIdentity.topLevel,
					gitCommonDir: gitIdentity.commonDir,
					vcs: "git",
				}) as Project
			}
		}
		return existing as Project
	}

	// Check if this directory is a known sandbox
	const sandbox = findSandboxByDirectory(directory)
	if (sandbox) {
		const sandboxProject = findProjectByDirectory(sandbox.directory)
		if (sandboxProject) return sandboxProject as Project
	}

	// Resolve git identity to share project across worktrees
	let gitIdentity = gitIdentityCache.get(directory)
	if (gitIdentity === undefined) {
		gitIdentity = await resolveGitIdentity(directory)
		gitIdentityCache.set(directory, gitIdentity)
	}

	if (gitIdentity) {
		// Look up by shared git common dir — all worktrees find the same project
		const byCommonDir = findProjectByGitCommonDir(gitIdentity.commonDir)
		if (byCommonDir) return byCommonDir as Project

		// Create project with git identity
		const project = upsertProject({
			id: ulid(),
			name: basename(gitIdentity.topLevel),
			directory,
			worktree: gitIdentity.topLevel,
			gitCommonDir: gitIdentity.commonDir,
			vcs: "git",
		})
		return project as Project
	}

	// Non-git project: create with directory-based identity
	const project = upsertProject({
		id: ulid(),
		name: basename(directory),
		directory,
	})
	return project as Project
}

/**
 * Workspace context middleware.
 * Extracts directory from x-workspace-directory header and runs
 * the request within the workspace's ALS context.
 * Also triggers workspace bootstrap on first init.
 */
export const workspaceMiddleware = createMiddleware(async (c, next) => {
	const dir = c.req.header("x-workspace-directory")
	if (!dir) return next()

	const isNew = !Workspace.has(dir)
	const ctx = await Workspace.init(dir, resolveOrCreateProject)

	if (isNew) {
		Workspace.run(ctx, () => bootstrapWorkspace(dir))
	}

	return Workspace.run(ctx, () => next())
})

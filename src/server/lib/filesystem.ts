import { realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, resolve, sep } from "node:path"

/**
 * Security error thrown when a path escapes the workspace.
 * Callers should catch this and return a tool error rather than crashing.
 */
export class PathEscapeError extends Error {
	constructor(attempted: string, workspace: string) {
		super(`Path escapes workspace: ${attempted} (workspace: ${workspace})`)
		this.name = "PathEscapeError"
	}
}

/**
 * Resolve and canonicalize an input path against the workspace root.
 *
 * Normalizes via realpath so symlinks cannot be used to escape the workspace.
 * For non-existent paths (e.g. a file about to be created), realpaths the
 * longest existing ancestor and re-joins the remainder — this prevents
 * attackers from pre-creating a dangling symlink at a target that will be
 * written to later.
 *
 * @param workspaceDir - The workspace root directory (already absolute)
 * @param inputPath - Absolute or workspace-relative path from untrusted input
 * @returns The canonicalized absolute path, guaranteed to be inside workspaceDir
 * @throws {PathEscapeError} if the canonical path is not inside workspaceDir
 */
export function resolveInWorkspace(workspaceDir: string, inputPath: string): string {
	const workspaceRoot = canonicalize(workspaceDir)
	const target = isAbsolute(inputPath) ? resolve(inputPath) : resolve(workspaceRoot, inputPath)
	const canonical = canonicalize(target)
	if (!isInsideOrEqual(workspaceRoot, canonical)) {
		throw new PathEscapeError(inputPath, workspaceRoot)
	}
	return canonical
}

/**
 * Check whether `child` is identical to or nested under `parent`.
 * Both paths are expected to be absolute and already canonicalized.
 */
export function isInsideOrEqual(parent: string, child: string): boolean {
	if (child === parent) return true
	return child.startsWith(parent + sep)
}

/**
 * Canonicalize a path via realpath, falling back to walking up the parent
 * chain if the leaf (or intermediate) doesn't exist yet. Used for paths
 * that may be about to be created.
 *
 * For fully-nonexistent roots (e.g. filesystem root), returns the path as-is.
 */
function canonicalize(input: string): string {
	const abs = resolve(input)
	try {
		return realpathSync(abs)
	} catch {
		// Walk up until we find an existing ancestor.
	}

	const parts: string[] = []
	let current = abs
	while (true) {
		const parent = dirname(current)
		if (parent === current) {
			// Reached filesystem root without finding an existing ancestor.
			return abs
		}
		parts.unshift(basename(current))
		current = parent
		try {
			const real = realpathSync(current)
			return resolve(real, ...parts)
		} catch {
			// Keep walking up.
		}
	}
}

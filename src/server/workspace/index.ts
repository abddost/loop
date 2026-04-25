import { AsyncLocalStorage } from "node:async_hooks"
import { resolve } from "node:path"
import type { Project } from "@core/schema/project"
import { type WorkspaceContext, createWorkspaceContext } from "./context"

export type { WorkspaceContext } from "./context"

export namespace Workspace {
	const als = new AsyncLocalStorage<WorkspaceContext>()
	const cache = new Map<string, WorkspaceContext>()
	const pending = new Map<string, Promise<WorkspaceContext>>()

	// ── Execution Context ─────────────────────────────────

	/** Run fn within a workspace's async context. All downstream async ops inherit it. */
	export function run<T>(ctx: WorkspaceContext, fn: () => T): T {
		return als.run(ctx, fn)
	}

	/** Get current workspace context. Throws if called outside Workspace.run(). */
	export function current(): WorkspaceContext {
		const ctx = als.getStore()
		if (!ctx)
			throw new Error("Not in a workspace context. Ensure code runs inside Workspace.run().")
		return ctx
	}

	/** Current workspace directory. Zero-arg. */
	export function dir(): string {
		return current().directory
	}

	/** Current workspace project. Zero-arg. */
	export function project(): Project {
		return current().project
	}

	// ── State Registration ────────────────────────────────

	/**
	 * Declare workspace-scoped synchronous state.
	 * Returns a zero-arg callable: () => T
	 * Factory runs on first call per workspace. Dispose runs on workspace close.
	 *
	 * @example
	 * const sessionStates = Workspace.state(
	 *   () => ({} as Record<string, SessionState>),
	 *   async (states) => { for (const s of Object.values(states)) s.abort.abort() }
	 * )
	 * // Usage: sessionStates()[sessionId]
	 */
	export function state<T>(
		factory: () => T,
		dispose?: (value: T) => void | Promise<void>,
	): () => T {
		const id = Symbol()
		return () => current()._store.getOrInit(id, factory, dispose)
	}

	/**
	 * Declare workspace-scoped async state (services that need await).
	 * Returns a zero-arg callable: () => Promise<T>
	 * Concurrent calls during init share one Promise (deduped).
	 *
	 * @example
	 * const lsp = Workspace.lazy(
	 *   async () => { const m = new LSPManager(Workspace.dir()); await m.start(); return m },
	 *   async (m) => await m.shutdown()
	 * )
	 * // Usage: const manager = await lsp()
	 */
	export function lazy<T>(
		factory: () => Promise<T>,
		dispose?: (value: T) => void | Promise<void>,
	): () => Promise<T> {
		const id = Symbol()
		return () => current()._store.getOrInitAsync(id, factory, dispose)
	}

	// ── Registry (Lifecycle) ──────────────────────────────

	/**
	 * Get or create a workspace context. Deduplicates concurrent init calls.
	 *
	 * Optional `initFn` runs inside the cached promise, within the workspace's
	 * ALS context. Concurrent callers for the same directory share one init run —
	 * this is what makes bootstrap side-effects (bridge registration, MCP, file
	 * watcher) race-safe.
	 *
	 * @param directory - Absolute path to the workspace directory
	 * @param projectResolver - Function that resolves/creates the project record
	 * @param initFn - Optional one-shot init callback run inside the workspace ALS
	 */
	export async function init(
		rawDirectory: string,
		projectResolver: (dir: string) => Project | Promise<Project>,
		initFn?: () => void | Promise<void>,
	): Promise<WorkspaceContext> {
		const directory = resolve(rawDirectory)

		const cached = cache.get(directory)
		if (cached) return cached

		const inflight = pending.get(directory)
		if (inflight) return inflight

		const promise = Promise.resolve(projectResolver(directory)).then(async (project) => {
			const ctx = createWorkspaceContext(directory, project)
			if (initFn) await als.run(ctx, async () => initFn())
			cache.set(directory, ctx)
			pending.delete(directory)
			return ctx
		})
		// Evict from pending on failure so callers can retry.
		promise.catch(() => pending.delete(directory))
		pending.set(directory, promise)
		return promise
	}

	/** Get cached workspace context (or undefined if not initialized). */
	export function get(directory: string): WorkspaceContext | undefined {
		return cache.get(resolve(directory))
	}

	/** Check if a workspace is initialized. */
	export function has(directory: string): boolean {
		return cache.has(resolve(directory))
	}

	/** List all active workspace directories. */
	export function list(): string[] {
		return [...cache.keys()]
	}

	/** Dispose a single workspace. Runs all state disposers. */
	export async function dispose(rawDirectory: string): Promise<void> {
		const directory = resolve(rawDirectory)
		const ctx = cache.get(directory)
		if (!ctx) return
		cache.delete(directory)
		await ctx.dispose()
	}

	/** Dispose all workspaces. Called on process exit. */
	export async function disposeAll(): Promise<void> {
		// Wait for any pending inits to complete before disposing
		await Promise.allSettled([...pending.values()])
		const errors: Error[] = []
		for (const [, ctx] of cache) {
			try {
				await ctx.dispose()
			} catch (e) {
				errors.push(e as Error)
			}
		}
		cache.clear()
		pending.clear()
		if (errors.length) throw new AggregateError(errors, "Workspace disposeAll errors")
	}

	/** @internal For testing: reset all state */
	export function _reset(): void {
		cache.clear()
		pending.clear()
	}
}

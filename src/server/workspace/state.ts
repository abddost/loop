/**
 * Internal state container that powers Workspace.state() and Workspace.lazy().
 * Handles lazy initialization, async deduplication, and automatic disposal.
 */
export class StateContainer {
	private values = new Map<symbol, unknown>()
	private pending = new Map<symbol, Promise<unknown>>()
	private disposers: Array<() => void | Promise<void>> = []

	/**
	 * Get or synchronously initialize state for the given key.
	 * Factory runs exactly once per workspace.
	 */
	getOrInit<T>(id: symbol, factory: () => T, dispose?: (value: T) => void | Promise<void>): T {
		if (this.values.has(id)) return this.values.get(id) as T
		const value = factory()
		this.values.set(id, value)
		if (dispose) this.disposers.push(() => dispose(value))
		return value
	}

	/**
	 * Get or asynchronously initialize state. Concurrent calls during init
	 * share one Promise (deduplication prevents double-init).
	 */
	async getOrInitAsync<T>(
		id: symbol,
		factory: () => Promise<T>,
		dispose?: (value: T) => void | Promise<void>,
	): Promise<T> {
		if (this.values.has(id)) return this.values.get(id) as T
		const inflight = this.pending.get(id)
		if (inflight) return inflight as Promise<T>
		const promise = factory().then((value) => {
			this.values.set(id, value)
			this.pending.delete(id)
			if (dispose) this.disposers.push(() => dispose(value))
			return value
		})
		this.pending.set(id, promise)
		return promise
	}

	/**
	 * Dispose all state. Awaits pending inits first.
	 * Uses Promise.allSettled semantics — one failure doesn't block others.
	 * @throws AggregateError if any disposers fail
	 */
	async disposeAll(): Promise<void> {
		// Wait for any pending async initializations to complete
		await Promise.allSettled([...this.pending.values()])
		const errors: Error[] = []
		// Run disposers in reverse order (LIFO)
		for (let i = this.disposers.length - 1; i >= 0; i--) {
			try {
				await this.disposers[i]()
			} catch (e) {
				errors.push(e as Error)
			}
		}
		this.values.clear()
		this.pending.clear()
		this.disposers.length = 0
		if (errors.length) throw new AggregateError(errors, "Workspace disposal errors")
	}
}

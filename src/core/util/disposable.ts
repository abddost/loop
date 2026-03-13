/**
 * Interface for resources that need cleanup.
 */
export interface Disposable {
	dispose(): void | Promise<void>
}

/**
 * Manages a group of disposables and disposes them all with Promise.allSettled semantics.
 */
export class DisposableGroup {
	private readonly disposables: Disposable[] = []

	/**
	 * Adds a disposable to the group.
	 * @param disposable - The disposable to add
	 */
	add(disposable: Disposable): void {
		this.disposables.push(disposable)
	}

	/**
	 * Disposes all managed disposables using Promise.allSettled.
	 * Errors from individual disposables do not prevent others from being disposed.
	 * @returns Results of all dispose operations
	 */
	async disposeAll(): Promise<PromiseSettledResult<void>[]> {
		const results = await Promise.allSettled(
			this.disposables.map((d) => Promise.resolve(d.dispose())),
		)
		this.disposables.length = 0
		return results
	}
}

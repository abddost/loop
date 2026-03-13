/**
 * A deferred promise that can be resolved or rejected externally.
 */
export class Deferred<T> {
	readonly promise: Promise<T>
	resolve!: (value: T | PromiseLike<T>) => void
	reject!: (reason?: unknown) => void
	settled = false

	constructor() {
		this.promise = new Promise<T>((res, rej) => {
			this.resolve = (value) => {
				this.settled = true
				res(value)
			}
			this.reject = (reason) => {
				this.settled = true
				rej(reason)
			}
		})
	}
}

/**
 * Races a promise against a timeout.
 * @param promise - The promise to race
 * @param ms - Timeout in milliseconds
 * @param message - Optional error message on timeout
 * @returns The resolved value of the promise
 * @throws Error if the timeout is reached before the promise resolves
 */
export async function pTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message ?? `Timed out after ${ms}ms`)), ms)
	})
	try {
		return await Promise.race([promise, timeout])
	} finally {
		clearTimeout(timer!)
	}
}

/**
 * Abort-safe sleep that rejects if the signal is aborted.
 * @param ms - Duration in milliseconds
 * @param signal - Optional AbortSignal to cancel the sleep
 * @returns A promise that resolves after the given duration
 * @throws Error if the signal is aborted before the sleep completes
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new Error("Aborted"))
			return
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort)
			resolve()
		}, ms)
		function onAbort() {
			clearTimeout(timer)
			reject(signal!.reason ?? new Error("Aborted"))
		}
		signal?.addEventListener("abort", onAbort, { once: true })
	})
}

/**
 * Returns a promise that rejects when the given signal is aborted.
 * @param signal - The AbortSignal to watch
 * @returns A promise that rejects with the signal's reason on abort
 */
export function abortPromise(signal: AbortSignal): Promise<never> {
	return new Promise<never>((_, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? new Error("Aborted"))
			return
		}
		signal.addEventListener("abort", () => reject(signal.reason ?? new Error("Aborted")), {
			once: true,
		})
	})
}

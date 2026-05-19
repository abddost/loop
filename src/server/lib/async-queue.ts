/**
 * Async queue with backpressure-friendly push/consume semantics.
 *
 * Producers call `push(item)` (non-blocking). Consumers iterate via
 * `for await (const item of queue)`; the loop awaits a Promise when the
 * queue is empty and resolves it the moment the next push lands.
 *
 * Used by the SSE endpoint to decouple bus emission from socket writes:
 * a slow client can no longer block GlobalBus.emit() — items accumulate
 * in the queue, and the consumer drains them as fast as the socket will
 * accept.
 *
 * Pattern adapted from opencode's util/queue.ts.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
	private items: T[] = []
	private resolvers: ((value: T) => void)[] = []

	push(item: T): void {
		const resolve = this.resolvers.shift()
		if (resolve) resolve(item)
		else this.items.push(item)
	}

	private next(): Promise<T> {
		if (this.items.length > 0) return Promise.resolve(this.items.shift()!)
		return new Promise((resolve) => this.resolvers.push(resolve))
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) yield await this.next()
	}
}

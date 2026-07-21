/**
 * Serialized transition queue.
 *
 * Every public runtime method enqueues onto a single promise chain. This makes
 * Obsidian/DOM callback arrival order irrelevant: transitions apply in the
 * order the queue receives them, and a failed operation is caught at the queue
 * boundary so it cannot break serialization for later recovery.
 *
 * The queue is the single place that turns concurrent-looking callbacks into a
 * deterministic sequence the engine can reason about.
 */

export class TransitionQueue {
	private tail: Promise<unknown> = Promise.resolve();
	private readonly onError: (error: unknown) => void;
	private closed = false;

	constructor(onError: (error: unknown) => void = () => {}) {
		this.onError = onError;
	}

	/**
	 * Enqueue a transition. Resolves with the transition's result, or rejects
	 * after the queue-level error handler has run. A rejection does not poison
	 * later transitions: each enqueue chains from the previous tail's settled
	 * (not rejected) state.
	 */
	enqueue<T>(task: () => T | Promise<T>): Promise<T> {
		if (this.closed) {
			return Promise.reject(new Error('tracking-runtime-closed'));
		}
		const run = this.tail.then(task, task);
		// Advance the tail from a fresh resolved state so a thrown transition
		// cannot cascade into subsequent ones.
		this.tail = run.then(
			() => undefined,
			(error) => {
				this.onError(error);
				return undefined;
			},
		);
		return run;
	}

	/** Stop accepting new transitions. Existing tail still settles. */
	close(): void {
		this.closed = true;
	}

	/** Resolves once the current tail has settled (used on shutdown flush). */
	async idle(): Promise<void> {
		await this.tail;
	}
}

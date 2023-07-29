/**
 * @todo rewrite to specialized data structure (ring buffer, LL...)
 */
export class Queue<V> {

	#array_m: Array<V> = []
	#capacity

	constructor(capacity = Number.MAX_SAFE_INTEGER) {
		this.#capacity = capacity
	}

	get isEmpty() {
		return this.#array_m.length === 0
	}

	get isFull() {
		return this.#array_m.length === this.#capacity
	}

	deQ() {
		return this.#array_m.pop()
	}

	enQ(x: V) {
		this.#array_m.unshift(x)
	}
}
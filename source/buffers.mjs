/** @template Val */
export class ArrayQueue {

	/** @type Array<Val> */
	#array = []
	#capacity

	constructor(capacity = Number.MAX_SAFE_INTEGER) {
		this.#capacity = capacity
	}

	get isEmpty() {
		return this.#array.length === 0
	}
	get isFull() {
		return this.#array.length === this.#capacity
	}

	pull() {
		return this.#array.pop()
	}

   /** @param {Val} x */
	push(x) {
		this.#array.unshift(x)
	}
}
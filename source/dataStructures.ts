/**
 * @todo rewrite to specialized data structure (ring buffer, LL...)
 */
export class Queue<V> {

	_array_m: Array<V> = []
	_capacity

	constructor(capacity = Number.MAX_SAFE_INTEGER) {
		this._capacity = capacity
	}

	get isEmpty() {
		return this._array_m.length === 0
	}

	get isFull() {
		return this._array_m.length === this._capacity
	}

	clear() {
		this._array_m = []
	}

	deQ() {
		return this._array_m.pop()
	}

	enQ(x: V) {
		this._array_m.unshift(x)
	}
}


export class ArraySet<V> {
	_array_m: Array<V> = []

	delete(v: V): void {
		const arr = this._array_m
		const v_idx = arr.indexOf(v)
		// arr.
	}

	size(): number {
		return this._array_m.length
	}

	add(v: V): void {
		this._array_m.push(v)
	}
}
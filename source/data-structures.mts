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


export class ArrSet<V> {
	arr_m: Array<V> = []

	delete(v: V): this {
		let arr = this.arr_m
		arr.splice(arr.indexOf(v), 1)  // todo splice is expensive
		return this
	}

	get size(): number {
		return this.arr_m.length
	}

	add(v: V): this {
		this.arr_m.push(v)
		return this
	}

	// [Symbol.iterator] = this._array_m[Symbol.iterator]
}


const Q_VAL_PREFIX = "$_q$"
/**
 * - Callback arrays grow forever (splice() is expensive). It's ok since
 * 	callback deletions rarely happen in usage of this data structure.
 * - _on() returns and array idx so that callers can remove at
 * 	O(1) (marking undefined)
 * - There's a queue of 1 for each event name to be consumed (if exists) when
 * 	.on() arrives.
 *		Todo: I don't thinK I need this behavior
 *      simplify when cancel deadlines are added.
 */
export class Events {

	#store_m: Store = {}

	_on<CBArgs = unknown>(name: string, cb: CB<CBArgs>): number | undefined {

		let store = this.#store_m

		const qKey = Q_VAL_PREFIX + name
		const qVal = store[qKey]
		if (qVal) {
			cb(qVal as CBArgs)
			store[qKey] = undefined
			return
		}

		let cbs = store[name]

		if (!cbs) {
			store[name] = cb as CB
			return 0  // when a new cb comes, an arr is created and this cb becomex idx = 0
		}

		if (typeof cbs === "function") {
			store[name] = cbs = [cbs]
		}

		cbs.push(cb as CB)
		return cbs.length - 1
	}


	// make sure to call .on() first for the same event name
	_off(name: string, idx: number) {
		let store = this.#store_m
		let cbs = store[name]!
		if (typeof cbs === "function") {
			store[name] = undefined
		}
		else {
			cbs[idx] = undefined
		}
	}

	_removeEvCBs(name: string) {
		this.#store_m[name] = undefined
	}

	_emit(name: string, val: unknown) {
		let store = this.#store_m
		let cbs = store[name]

		if (!cbs) {
			store[Q_VAL_PREFIX + name] = val as undefined
			return
		}

		if (typeof cbs === "function") {
			cbs(val)
			store[name] = undefined
			return
		}

		const l = cbs.length
		for (let i = 0; i < l; i++) {
			const cb = cbs[i]
			if (cb) {
				cb(val)
				cbs[i] = undefined
			}
		}
	}

	// store[name] can be [...undefined], but it's ok since _emit() will be noop
	_haveCBs(name: string) {
		return this.#store_m[name]
	}
}

type CB<Args = unknown> = (args: Args) => void

type CBs = undefined | CB | Array<CB | undefined>

type Store = {
	[key: string]: CBs;
}

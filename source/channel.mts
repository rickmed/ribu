import { resume as resume, Prc, type Gen, go } from "./process.mjs"
import { getRunningPrcOrThrow } from "./initCsp.mjs"


export const DONE = Symbol("ribu chan DONE")


export function ch<V = undefined>(capacity = 0): Ch<V> {
	const _ch = capacity === 0 ? new Chan<V>() : new BufferedChan<V>(capacity)
	return _ch
}

export type Ch<V = undefined> = {
   get rec(): Gen<V, V>,
	put(msg: V): "PARK" | "RESUME",
   put(...msg: V extends undefined ? [] : [V]): "PARK" | "RESUME",
	get isNotDone(): boolean
	close(): void
   enQueue(msg: V): void,
}


export class BaseChan<V> {

	protected _waitingPutters = new Queue<Prc>()
	protected _waitingReceivers = new Queue<Prc>()
	protected _enQueuedMsgs = new Queue<V>()
	protected _closed = false

	close() {
		this._closed = true
	}

	enQueue(msg: V): void {
		if (this._closed) {
			throw Error(`ribu: can't enQueue() on a closed channel`)
		}
		const receiverPrc = this._waitingReceivers.deQ()
		if (!receiverPrc) {
			this._enQueuedMsgs.enQ(msg)
			return
		}
		resume(receiverPrc, msg)
	}

	/* Subclasses below overwrite it.
	 * Needed for "value instanceof BaseChan" in proceed(prc)
	*/
	// get rec() { return YIELD }
}


class Chan<V> extends BaseChan<V> implements Ch<V> {

	/**
	 * Need to use full generator, ie, yield*, instead of just yield, because
	 * typescript can't preserve the types between what is yielded and what is
	 * returned at gen.next()
	 */
	get rec(): Gen<V, V> {

		const receiverPrc = getRunningPrcOrThrow(`can't receive outside a process.`)
		let putterPrc = this._waitingPutters.deQ()
		const thisCh = this  // eslint-disable-line @typescript-eslint/no-this-alias

		function* _rec(): Gen<V, V> {
			if (!putterPrc) {
				thisCh._waitingReceivers.enQ(receiverPrc)
				const msg = yield "PARK"
				return msg
			}

			const {_enQueuedMsgs} = thisCh
			if (!_enQueuedMsgs.isEmpty) {
				return _enQueuedMsgs.deQ()!
			}

			else {
				resume(putterPrc)
				const msg = putterPrc._chanPutMsg_m as V
				return msg
			}

		}

		return _rec()
	}

	/**
	 * No need to pay the cost of using yield* because put() returns nothing
	 * within a process, so no type preserving needed.
	 */
   put(msg?: V): "PARK" | "RESUME" {

		if (this._closed) {
			throw Error(`ribu: can't put() on a closed channel`)
		}

		const putterPrc = getRunningPrcOrThrow(`can't put outside a process.`)
		let receiverPrc = this._waitingReceivers.deQ()

		if (!receiverPrc) {
			this._waitingPutters.enQ(putterPrc)
			return "PARK"
		}

		resume(receiverPrc, msg)
		return "RESUME"
	}

	get isNotDone() {
		return this._waitingPutters.isEmpty ? false : true
	}
}


class BufferedChan<V> extends BaseChan<V> implements Ch<V> {

	#buffer: Queue<V>
	isFull: boolean

	constructor(capacity: number) {
		super()
		const buffer = new Queue<V>(capacity)
		this.#buffer = buffer
		this.isFull = buffer.isFull
	}

	get rec(): Gen<V, V> {

		const receiverPrc = getRunningPrcOrThrow(`can't receive outside a process.`)
		const thisCh = this  // eslint-disable-line @typescript-eslint/no-this-alias

		function* _rec(): Gen<V, V> {

			const buffer = thisCh.#buffer
			const msg = buffer.deQ()

			if (msg === undefined) {
				thisCh._waitingReceivers.enQ(receiverPrc)
				const msg = yield "PARK"
				return msg
			}

			const putterPrc = thisCh._waitingPutters.deQ()

			if (putterPrc) {
				buffer.enQ(putterPrc._chanPutMsg_m as V)
				resume(putterPrc)
			}

			return msg
		}

		return _rec()
	}

	put(msg?: V): "PARK" | "RESUME" {

		if (this._closed) {
			throw Error(`ribu: can't put on a closed channel`)
		}

		const putterPrc = getRunningPrcOrThrow(`can't put outside a process.`)

		const buffer = this.#buffer

		if (buffer.isFull) {
			putterPrc._chanPutMsg_m = msg
			this._waitingPutters.enQ(putterPrc)
			return "PARK"
		}

		const {_waitingReceivers} = this
		let receiverPrc = _waitingReceivers.deQ()

		if (!receiverPrc) {
			buffer.enQ(msg as V)
			resume(putterPrc)
			return "RESUME"
		}

		while (receiverPrc) {
			if (receiverPrc._state === "RUNNING") {
				resume(receiverPrc, msg)
				break
			}
			receiverPrc = _waitingReceivers.deQ()
		}
		return "RESUME"
	}

	get isNotDone() {
		return this.#buffer.isEmpty && this._waitingPutters.isEmpty ? false : true
	}
}


/**
 * @todo rewrite to specialized data structure (ring buffer, LL...)
 */
class Queue<V> {

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



// @todo
// /**
//  * @template TChVal
//  * @implements {Ribu.Ch<TChVal>}
//  */
// export class BroadcastCh {

// 	/** @type {Ch | Array<Ch> | undefined} */
// 	#listeners = undefined

// 	/** @return {_Ribu.YIELD_VAL} */
// 	get rec() {

// 		const listenerCh = ch()
// 		const listeners = this.#listeners

// 		if (listeners === undefined) {
// 			this.#listeners = listenerCh
// 		}
// 		else if (Array.isArray(listeners)) {
// 			listeners.push(listenerCh)
// 		}
// 		else {
// 			this.#listeners = []
// 			this.#listeners.push(listenerCh)
// 		}

// 		return listenerCh
// 	}

// 	/** @type {() => _Ribu.YIELD_VAL} */
// 	put() {

// 		const notifyDone = ch()
// 		const listeners = this.#listeners

// 		go(function* _emit() {
// 			if (listeners === undefined) {
// 				yield notifyDone
// 				return
// 			}
// 			if (Array.isArray(listeners)) {
// 				for (const ch of listeners) {
// 					yield ch.put()
// 				}
// 				yield notifyDone
// 				return
// 			}
// 			yield listeners.put()
// 			yield notifyDone.rec
// 		})

// 		return notifyDone.put()
// 	}

// 	/** @type {(msg: TChVal) => void} */
// 	dispatch(msg) {

// 	}
// }



export function all(...chanS: Ch[]): Ch {

	const allDone = ch()
	const chansL = chanS.length
	const notifyDone = ch(chansL)

	for (const chan of chanS) {
		go(function* _all() {
			yield* chan.rec
			yield notifyDone.put()
		})
	}

	go(function* _collectDones() {
		let nDone = 0
		while (nDone < chansL) {
			yield* notifyDone.rec
			nDone++
		}
		yield allDone.put()
	})

	return allDone
}

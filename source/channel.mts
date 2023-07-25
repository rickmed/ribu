import { go, type Prc } from "./process.mjs"
import { csp, getRunningPrc } from "./initCsp.mjs"

export const DONE = Symbol("ribu chan DONE")

// export function ch<V = undefined>(): Chan<V>
export function ch<V = undefined>(capacity = 0): Ch<V> {
	const _ch = capacity === 0 ? new Chan<V>() : new BufferedChan<V>(capacity)
	return _ch
}

class BaseChan {

	protected _waitingPutters = new Queue<Prc>()
	protected _waitingReceivers = new Queue<Prc>()
	protected _closed = false

	close() {
		this._closed = true
	}
}

class Chan<V> extends BaseChan implements Ch<V> {

	get rec(): Promise<V> {

		const receiverPrc = getRunningPrc(`can't receive outside a process.`)

		return new Promise<V>(resolveReceiver => {

			const putterPrc = this._waitingPutters.pull()

			if (!putterPrc) {
				receiverPrc._promResolve<V> = resolveReceiver
				this._waitingReceivers.push(receiverPrc)
				return
			}

			/**
			 * Exchange msg:
			 * Since the await continuations are called async after these resolvers
			 * are called, we need to set a queue of prcS so that the next ribu
			 * operations in the respective asyncFn can runningPrcS_m.pull()
			 * the correct running prc.
			 * The waiting prc needs to be resolved first since that is the order
			 * the javascript runtime does it (the important thing is
			 * csp.runningPrcS_m push order)
			 */

			/** If putterPrc was cancelled, it will never be resolved and be GCed eventually */
			if (putterPrc._state === "RUNNING") {
				putterPrc._promResolve!(undefined)
				csp.runningPrcS_m.unshift(putterPrc)
			}

			csp.runningPrcS_m.unshift(receiverPrc)
			resolveReceiver(putterPrc._chanPutMsg_m as V)
		})
	}

	put(msg?: V): Promise<void> {

		if (this._closed) {
			throw new Error(`ribu: can't put on a closed channel`)
		}

		const putterPrc = getRunningPrc(`can't put outside a process.`)
		const { _waitingReceivers } = this

		return new Promise(resolvePutter => {

			let receiverPrc = _waitingReceivers.pull()

			if (!receiverPrc) {
				putterPrc._promResolve<void> = resolvePutter
				putterPrc._chanPutMsg_m = msg
				this._waitingPutters.push(putterPrc)
				return
			}

			/** If a receiverPrc is cancelled, discard and resolve the next in _waitingReceivers */
			while (receiverPrc) {

				if (receiverPrc._state === "RUNNING") {
					csp.runningPrcS_m.unshift(putterPrc, receiverPrc)
					receiverPrc._promResolve!(msg)
					resolvePutter(undefined)
					return
				}

				receiverPrc = _waitingReceivers.pull()
			}
		})
	}

	get isNotDone() {
		return this._waitingPutters.isEmpty ? false : true
	}

	// then(onRes: (v: V) => V) {
	// 	return this.rec.then(onRes)
	// }
}


class BufferedChan<V> extends BaseChan implements Ch<V> {

	#buffer: Queue<V>
	isFull: boolean

	constructor(capacity: number) {
		super()
		const buffer = new Queue<V>(capacity)
		this.#buffer = buffer
		this.isFull = buffer.isFull
	}

	get rec(): Promise<V> {

		const receiverPrc = getRunningPrc(`can't receive outside a process.`)

		return new Promise<V>(resolveReceiver => {

			const msg = this.#buffer.pull()

			if (msg === undefined) {  // buffer is empty
				receiverPrc._promResolve<V> = resolveReceiver
				this._waitingReceivers.push(receiverPrc)
				return
			}

			const putterPrc = this._waitingPutters.pull()

			if (putterPrc !== undefined) {

				this.#buffer.push(putterPrc._chanPutMsg_m as V)

				if (putterPrc._state === "RUNNING") {
					csp.runningPrcS_m.unshift(putterPrc)
					putterPrc._promResolve!(undefined)
				}
			}

			csp.runningPrcS_m.unshift(receiverPrc)
			resolveReceiver(msg)
		})
	}

	put(msg?: V): Promise<void> {

		if (this._closed) {
			throw new Error(`ribu: can't put on a closed channel`)
		}

		const putterPrc = getRunningPrc(`can't put outside a process.`)

		return new Promise(resolvePutter => {

			const buffer = this.#buffer

			if (buffer.isFull) {
				putterPrc._promResolve<void> = resolvePutter
				putterPrc._chanPutMsg_m = msg
				this._waitingPutters.push(putterPrc)
				return
			}

			const {_waitingReceivers} = this
			let receiverPrc = _waitingReceivers.pull()

			if (!receiverPrc) {
				buffer.push(msg)
				csp.runningPrcS_m.unshift(putterPrc)
				resolvePutter(undefined)
				return
			}

			while (receiverPrc) {
				if (receiverPrc._state === "RUNNING") {
					csp.runningPrcS_m.unshift(putterPrc, receiverPrc)
					receiverPrc._promResolve!(msg)
					resolvePutter(undefined)
					return
				}
				receiverPrc = _waitingReceivers.pull()
			}
		})
	}

	get isNotDone() {
		return this.#buffer.isEmpty && this._waitingPutters.isEmpty ? false : true
	}

	// then(onRes: (v: V) => V) {
	// 	return this.rec.then(onRes)
	// }
}



/* === Types ====================================================== */

export type Ch<V = undefined> = {
	get rec(): Promise<V>,
	put(msg: V): Promise<void>,
	put(...msg: V extends undefined ? [] : [V]): Promise<void>,
	get isNotDone(): boolean
	close(): void
	// then(onRes: (v: V) => V): Promise<V>
}



/* === Queue class ====================================================== */

/**
 * @todo rewrite to specialized data structure (ring buffer, LL...)
 */
class Queue<V> {

	#array_m: Array<V> = []
	#capacity

	constructor(capacity = Number.MAX_SAFE_INTEGER) {
		this.#capacity = capacity
	}

	get isFull() {
		return this.#array_m.length === this.#capacity
	}

	get isEmpty() {
		return this.#array_m.length === 0 ? true : false
	}

	pull() {
		// @todo: check if empty when using other data structures
		return this.#array_m.pop()
	}

	push(x?: V) {
		this.#array_m.unshift(x as V)
	}
}




/* === Public helpers ====================================================== */

export function all(...chanS: Ch[]): Ch {

	const allDone = ch()
	const chansL = chanS.length
	const notifyDone = ch(chansL)

	for (const chan of chanS) {
		go(async function _all() {
			await chan.rec
			await notifyDone.put()
		})
	}

	go(async function _collectDones() {
		let nDone = 0
		while (nDone < chansL) {
			await notifyDone.rec
			nDone++
		}
		await allDone.put()
	})

	return allDone
}


// // @todo
// // /**
// //  * @template TChVal
// //  * @implements {Ribu.Ch<TChVal>}
// //  */
// // export class BroadcastCh {

// // 	/** @type {Ch | Array<Ch> | undefined} */
// // 	#listeners = undefined

// // 	/** @return {_Ribu.YIELD_VAL} */
// // 	get rec() {

// // 		const listenerCh = ch()
// // 		const listeners = this.#listeners

// // 		if (listeners === undefined) {
// // 			this.#listeners = listenerCh
// // 		}
// // 		else if (Array.isArray(listeners)) {
// // 			listeners.push(listenerCh)
// // 		}
// // 		else {
// // 			this.#listeners = []
// // 			this.#listeners.push(listenerCh)
// // 		}

// // 		return listenerCh
// // 	}

// // 	/** @type {() => _Ribu.YIELD_VAL} */
// // 	put() {

// // 		const notifyDone = ch()
// // 		const listeners = this.#listeners

// // 		go(function* _emit() {
// // 			if (listeners === undefined) {
// // 				yield notifyDone
// // 				return
// // 			}
// // 			if (Array.isArray(listeners)) {
// // 				for (const ch of listeners) {
// // 					yield ch.put()
// // 				}
// // 				yield notifyDone
// // 				return
// // 			}
// // 			yield listeners.put()
// // 			yield notifyDone.rec
// // 		})

// // 		return notifyDone.put()
// // 	}

// // 	/** @type {(msg: TChVal) => void} */
// // 	dispatch(msg) {

// // 	}
// // }

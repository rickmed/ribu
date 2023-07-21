import { go, type Prc } from "./process.mjs"
import csp from "./initCsp.mjs"


export function ch<V = undefined>(capacity = 0): Ch<V> {
	const _ch = capacity === 0 ? new Chan<V>() : new BufferedChan<V>(capacity)
	return _ch
}


class BaseChan {
	protected _waitingPutters = new Queue<Prc>()
	protected _waitingReceivers = new Queue<Prc>()
}


class Chan<V> extends BaseChan implements Ch<V> {

	get rec(): Promise<V> {

		const receiverPrc = csp.runningPrc

		assertPrc(receiverPrc)

		if (receiverPrc._state !== "RUNNING") {
			return neverProm<V>()
		}

		return new Promise<V>(resolveReceiver => {

			const putterPrc = this._waitingPutters.pull()

			if (!putterPrc) {
				receiverPrc._promResolve<V> = resolveReceiver
				this._waitingReceivers.push(receiverPrc)
				return
			}

			/*	How the thing below works:
				prom.then(continuation) is called by means of await at the receiver
				asyncFn but no continuation is scheduled bc the promise is not
				resolved() yet. So it gives me a chance to setup csp.stackHead before
				the continuation is scheduled with resolve() (and ran immediately async).
				The same thing is done next for the putter asyncFn part, in order.
			*/
			queueMicrotask(() => {
				csp.runningPrc = receiverPrc
				resolveReceiver(putterPrc._chanPutMsg as V)
				resolveAsync(putterPrc)
			})

		})
	}

	put(msg?: V): Promise<void> {

		const putterPrc = csp.runningPrc

		assertPrc(putterPrc)

		if (putterPrc._state !== "RUNNING") {
			return neverProm()
		}

		return new Promise(resolvePutter => {

			const receiverPrc = this._waitingReceivers.pull()

			if (!receiverPrc) {
				putterPrc._promResolve<void> = resolvePutter
				putterPrc._chanPutMsg = msg
				this._waitingPutters.push(putterPrc)
				return
			}

			queueMicrotask(() => {
				csp.runningPrc = putterPrc
				resolvePutter()
				resolveAsync<V>(receiverPrc, msg)
			})
		})
	}

	then(onRes: (v: V) => V) {
		return this.rec.then(onRes)
	}
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

		const receiverPrc = csp.runningPrc

		assertPrc(receiverPrc)

		if (receiverPrc._state !== "RUNNING") {
			return neverProm<V>()
		}

		return new Promise<V>(resolveReceiver => {

			const msg = this.#buffer.pull()

			if (!msg) {  // buffer is empty
				receiverPrc._promResolve<V> = resolveReceiver
				this._waitingReceivers.push(receiverPrc)
				return
			}

			queueMicrotask(() => {
				csp.runningPrc = receiverPrc
				resolveReceiver(msg)
				const putterPrc = this._waitingPutters.pull()
				if (putterPrc) {
					resolveAsync<V>(putterPrc)
				}
			})

		})
	}

	put(msg?: V): Promise<void> {

		const putterPrc = csp.runningPrc

		assertPrc(putterPrc)

		if (putterPrc._state !== "RUNNING") {
			return neverProm()
		}

		return new Promise(resolvePutter => {

			const buffer = this.#buffer
			if (buffer.isFull) {
				putterPrc._promResolve<void> = resolvePutter
				this._waitingPutters.push(putterPrc)
				return
			}

			queueMicrotask(() => {
				csp.runningPrc = putterPrc
				resolvePutter()
				
				const receiverPrc = this._waitingReceivers.pull()
				if (receiverPrc) {
					resolveAsync<V>(receiverPrc, msg)
				}
				else {
					buffer.push(msg)
				}
			})

		})
	}

	then(onRes: (v: V) => V) {
		return this.rec.then(onRes)
	}
}

function assertPrc(runningPrc: Prc | undefined): asserts runningPrc {
	if (!runningPrc) {
		throw new Error(`ribu: can't receive outside a process`)
	}
}

/** a Promise that never resolves */
function neverProm<V = void>() {
	return new Promise<V>(() => {})
}

function resolveAsync<V = void>(prc: Prc, msg?: V) {
	queueMicrotask(() => {
		csp.runningPrc = prc
		prc._promResolve!(msg)
	})
}

/* === Types ====================================================== */

export type Ch<V = undefined> = {
	get rec(): Promise<V>,
	put(msg: V): Promise<void>,
	put(...msg: V extends undefined ? [] : [V]): Promise<void>,
	then(onRes: (v: V) => V): Promise<V>
}



/* === Queue class ====================================================== */

/**
 * @todo rewrite to specialized data structure (ring buffer, LL...)
 */
class Queue<V> {

	#array: Array<V> = []
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
		// @todo: check if empty when using other data structures
		return this.#array.pop()
	}

	push(x?: V) {
		this.#array.unshift(x as V)
	}
}




/* === Public helpers ====================================================== */

export function all(...chanS: Ch[]): Ch {

	const allDone = ch()
	const chansL = chanS.length
	const notifyDone = ch(chansL)

	for (const chan of chanS) {
		go(function* _all() {
			yield chan
			yield notifyDone.put()
		})
	}

	go(function* _collectDones() {
		let nDone = 0
		while (nDone < chansL) {
			yield notifyDone
			nDone++
		}
		yield allDone.put()
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

import { go, type Prc } from "./process.mjs"
import csp from "./initCsp.mjs"
import { type Csp } from "./Csp.mjs"


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

		const { runningPrc } = csp

		if (!runningPrc) {
			throw new Error(`ribu: can't receive outside a process`)
		}

		let resolveReceiver: PromResolve<V>
		const prom = new Promise<V>(res => resolveReceiver = res)

		if (runningPrc._state !== "RUNNING") {
			return prom
		}

		const putterPrc = this._waitingPutters.pull()

		if (!putterPrc) {
			runningPrc._promResolve<V> = resolveReceiver!
			this._waitingReceivers.push(runningPrc)
			return prom
		}

		/*	How the thing below works:
			prom.then(continuation) is called by means of await at the receiver
			asyncFn but no continuation is scheduled bc the promise is not
			resolved() yet. So it gives me a chance to setup csp.stackHead before
			the continuation is scheduled with resolve() (and ran immediately async).
			The same thing is done next for the putter asyncFn part, in order.
		*/
		queueMicrotask(() => {

			csp.runningPrc = runningPrc
			resolveReceiver(putterPrc._chanPutMsg as V)

			resolvePrc(csp, putterPrc)
		})

		return prom
	}

	put(msg?: V): Promise<void> {

		const { runningPrc } = csp

		if (!runningPrc) {
			throw new Error(`ribu: can't put outside a process`)
		}

		let resolvePutter: PromResolve
		const prom = new Promise<void>(res => resolvePutter = res)

		const { _waitingReceivers } = this

		if (_waitingReceivers.isEmpty) {
			runningPrc._promResolve<void> = resolvePutter!
			runningPrc._chanPutMsg = msg
			this._waitingPutters.push(runningPrc)
			return prom
		}

		const receiverPrc = _waitingReceivers.pull()!

		queueMicrotask(() => {

			csp.runningPrc = runningPrc
			resolvePutter()

			resolvePrc(csp, receiverPrc, msg)
		})

		return prom
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

		const { runningPrc } = csp

		if (!runningPrc) {
			throw new Error(`ribu: can't receive outside a process`)
		}

		let resolveReceiver: PromResolve<V>
		const prom = new Promise<V>(res => resolveReceiver = res)

		const msg = this.#buffer.pull()

		if (!msg) {
			runningPrc._promResolve<V> = resolveReceiver!
			this._waitingReceivers.push(runningPrc)
			return prom
		}

		queueMicrotask(() => {

			csp.runningPrc = runningPrc
			resolveReceiver(msg)

			const putterPrc = this._waitingPutters.pull()
			if (!putterPrc) {
				return
			}
			resolvePrc(csp, putterPrc)
		})

		return prom
	}

	put(msg?: V): Promise<void> {

		const { runningPrc } = csp

		if (!runningPrc) {
			throw new Error(`ribu: can't put outside a process`)
		}

		let resolvePutter: PromResolve
		const prom = new Promise<void>(res => resolvePutter = res)

		const buffer = this.#buffer
		if (buffer.isFull) {
			runningPrc._promResolve<void> = resolvePutter!
			this._waitingPutters.push(runningPrc)
			return prom
		}

		buffer.push(msg)

		queueMicrotask(() => {

			csp.runningPrc = runningPrc
			resolvePutter()

			const receiverPrc = this._waitingReceivers.pull()
			if (!receiverPrc) {
				return
			}
			resolvePrc(csp, receiverPrc, msg)
		})

		return prom
	}

	then(onRes: (v: V) => V) {
		return this.rec.then(onRes)
	}
}


// Chan helpers

function resolvePrc(csp: Csp, prc: Prc, msg?: unknown): void {
	const { _state: putterState, _promResolve: resolvePutter } = prc
	if (putterState === "RUNNING") {
		queueMicrotask(() => {
			csp.runningPrc = prc
			resolvePutter!(msg)
		})
	}
}


// Chan Types

export type Ch<V = undefined> = {
	get rec(): Promise<V>,
	put(msg: V): Promise<void>,
	put(...msg: V extends undefined ? [] : [V]): Promise<void>,
	then(onRes: (v: V) => V): Promise<V>
}

type PromResolve<V = void> = (value: V) => void



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

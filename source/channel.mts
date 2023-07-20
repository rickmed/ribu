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

		const runningPrc = csp.stackHead

		if (!runningPrc) {
			throw new Error(`ribu: can't receive outside a process`)
		}

		let resolveReceiver: (v: V) => void
		const prom = new Promise<V>(res => resolveReceiver = res)
		prom.then

		const { _waitingPutters } = this

		if (_waitingPutters.isEmpty) {
			runningPrc._promResolve<V> = resolveReceiver!
			this._waitingReceivers.push(runningPrc)
			return prom
		}

		/* _waitingPutter is NOT Empty - so cast ok */
		const putterPrc = _waitingPutters.pull()!

		/*	How the thing below works:
			prom.then(continuation) is called by means of await at the receiver
			asyncFn but no continuation is scheduled bc the promise is not
			resolved() yet. So it gives me a chance to setup csp.stackHead before
			the continuation is scheduled with resolve() (and ran immediately async).
			The same thing is done next for the putter asyncFn part, in order.
		*/
		queueMicrotask(() => {

			csp.stackHead = runningPrc
			resolveReceiver(putterPrc._chanPutMsg as V)

			const {_state: putterState, _promResolve: resolvePutter} = putterPrc
			if (putterState === "RUNNING") {
				queueMicrotask(() => {
					csp.stackHead = putterPrc
					resolvePutter!(undefined)
				})
			}
		})

		return prom
	}

	put(msg?: V): Promise<void> {

		const runningPrc = csp.stackHead

		if (!runningPrc) {
			throw new Error(`ribu: can't put outside a process`)
		}

		let resolvePutter: () => void
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

			csp.stackHead = runningPrc
			resolvePutter()

			const {_state: receiverState, _promResolve: resolveReceiver} = receiverPrc
			if (receiverState === "RUNNING") {
				queueMicrotask(() => {
					csp.stackHead = receiverPrc
					resolveReceiver!(msg)
				})
			}
		})

		return prom
	}

	then(onRes: (v: V) => void) {
		console.log("thenn", csp.stackHead?._fnName)
		const vallll = this.rec
		console.log({vallll})
		return onRes(vallll)
		// return val
		// return this.rec.then(x => onRes(x))

		/*
			await will immediately call Ch.then(continuation)
				continuation is saved internally, but not scheduled since prom isn't resolved
				how can i resolve it???

			take(ch) returns a prom

		*/


	}

	// then(onRes, onRej) {
	// 	// await will immediately then() and save onRes and onRej to be called later
	// 		// supposedly when the promise is resolved. how?
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

	put(msg?: V): Promise<void> {

		const runningPrc = csp.stackHead

		if (!runningPrc) {
			throw new Error(`ribu: can't put outside a process`)
		}

		return new Promise<void>(resolvePutter => {

			const buffer = this.#buffer

			if (buffer.isFull) {
				runningPrc._promResolve<void> = resolvePutter
				runningPrc._chanPutMsg = msg
				this._waitingPutters.push(runningPrc)
				return
			}

			const { _waitingReceivers } = this

			buffer.push(msg)
			csp.stackHead = runningPrc
			resolvePutter(undefined)

			if (_waitingReceivers.isEmpty) {
				return
			}

			/* _waitingReceivers is NOT Empty - so cast ok */
			const receiverPrc = _waitingReceivers.pull()!

			if (receiverPrc._state === "RUNNING") {
				const resolveReceiver = receiverPrc._promResolve!
				csp.stackHead = receiverPrc
				resolveReceiver(msg)
			}
		})
	}

	get rec(): Promise<V> {

		const runningPrc = csp.stackHead

		if (!runningPrc) {
			throw new Error(`ribu: can't receive outside a process`)
		}

		return new Promise<V>(resolveReceiver => {

			const buffer = this.#buffer

			if (buffer.isEmpty) {
				runningPrc._promResolve<V> = resolveReceiver
				this._waitingReceivers.push(runningPrc)
				return
			}

			const { _waitingPutters } = this

			/* buffer is NOT Empty - so cast ok */
			const msg = buffer.pull()!
			csp.stackHead = runningPrc
			resolveReceiver(msg)

			if (_waitingPutters.isEmpty) {
				return
			}

			/* _waitingPutters is NOT Empty - so cast ok */
			const putterPrc = _waitingPutters.pull()!

			if (putterPrc._state === "RUNNING") {
				const resolvePutter = putterPrc._promResolve!
				csp.stackHead = putterPrc
				resolvePutter(undefined)
			}
		})
	}
}


export type Ch<V = undefined> = {
	get rec(): Promise<V>,
	put(msg: V): Promise<void>,
	put(...msg: V extends undefined ? [] : [V]): Promise<void>,
	then(onRes: (v: V) => void): Promise<V>
}


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

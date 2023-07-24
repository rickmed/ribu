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


		const receiverPrc = getRunningPrc(`ribu: can't receive outside a process.`)
		console.log("REC(): called", receiverPrc._fnName)

		if (receiverPrc._state !== "RUNNING") {
			return neverProm<V>()
		}

		csp.runningPrc = undefined

		return new Promise<V>(resolveReceiver => {

			const putterPrc = this._waitingPutters.pull()

			if (!putterPrc) {
				receiverPrc._promResolve<V> = resolveReceiver
				this._waitingReceivers.push(receiverPrc)
				return
			}


/*
need to check cancellation things on channel ops

1) Think better resolve counterpart first to let it finish naturally


2) when cancel is done, there must be a guarantee that the prc will not put more msgs

- what happens to in transit messages? (not the one in bufferedChans)
	* All waitingPutters must be flushed.
       - All those messages must be received by the receivers
		 	if they choose to (ie, they aren't cancelled)

   * no additional


	=> If prc is blocked at rec and cancelled in the meantime:
		- when putter arrives it should pull the next waitingReceiver and resolve that one (delete resolve fn from cancelled prc)
			this way, the cancelled prc will be removed from chan [], be never resolved and be GCed eventually

	=> If am blocked at put and I'm cancelled in the meantime that the receiver arrives???
			- idem

	=> is is possible to be cancelled while the rec/put transaction is taking place?
			- MAAYYBE, but best to complete the transaction and the next put/rec will block forever
			- Will there msgs be lost between the application stages of all this?
				how to flush them?
					- a downstream process should probably cancel the first upstream stage.
					   - the top stage would stop sending msgs downtream.
						but then the middle stages would need some cleanup chance


*/


			/*	How the thing below works:
				prom.then(continuation) is called by means of await at the receiver
				asyncFn but no continuation is scheduled bc the promise is not
				resolved() yet. So it gives me a chance to setup csp.stackHead before
				the continuation is scheduled with resolve() (and ran immediately async).
				The same thing is done next for the putter asyncFn part, in order.
			*/
			queueMicrotask(() => {
				csp.runningPrc = receiverPrc
				console.log("REC(): RESOLVING RECEIVER", receiverPrc._fnName, {msg: putterPrc._chanPutMsg})
				resolveReceiver(putterPrc._chanPutMsg as V)
				queueMicrotask(() => {
					csp.runningPrc = putterPrc
					console.log("REC(): RESOLVING PUTTER", putterPrc._fnName)
					putterPrc._promResolve!(undefined)
				})
			})

		})
	}

	put(msg?: V): Promise<void> {

		const putterPrc = getRunningPrc(`ribu: can't put outside a process.`)

		console.log("PUT(): called", putterPrc._fnName)

		if (putterPrc._state !== "RUNNING") {
			return neverProm()
		}

		csp.runningPrc = undefined

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
				console.log("PUT(): RESOLVING PUTTER", putterPrc._fnName, {msg})
				resolvePutter()
				queueMicrotask(() => {
					csp.runningPrc = receiverPrc
					console.log("PUT(): RESOLVING RECEIVER", receiverPrc._fnName, {msg})
					receiverPrc._promResolve!(msg)
				})
			})
		})
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

		const receiverPrc = getRunningPrc(`ribu: can't receive outside a process.`)

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

		const putterPrc = getRunningPrc(`ribu: can't put outside a process.`)

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


export function getRunningPrc(onErrMsg: string): Prc {
	const {runningPrc} = csp
	if (!runningPrc) {
		throw new Error(`${onErrMsg} Did you forget to wrap a native Promise?`)
	}
	return runningPrc
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
	// then(onRes: (v: V) => V): Promise<V>
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
		return this.#array.pop()  // eslint-disable-line functional/immutable-data
	}

	push(x?: V) {
		this.#array.unshift(x as V)  // eslint-disable-line functional/immutable-data
	}
}




/* === Public helpers ====================================================== */

export function all(...chanS: Ch[]): Ch {

	const allDone = ch()
	const chansL = chanS.length
	const notifyDone = ch(chansL)

	for (const chan of chanS) {
		go(async function _all() {
			await chan
			await notifyDone.put()
		})
	}

	go(async function _collectDones() {
		let nDone = 0
		while (nDone < chansL) {
			await notifyDone
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

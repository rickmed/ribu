import { go, type Prc } from "./process.mjs"
import csp from "./initCsp.mjs"


export function ch<V = undefined>(capacity = 0): Ch<V> {
	const _ch = capacity === 0 ? new Chan<V>() : new BufferedChan<V>(capacity)
	return _ch
}


class BaseChan {
	protected _waitingSenders = new Queue<Prc>()
	protected _waitingReceivers = new Queue<Prc>()
}

class Chan<V> extends BaseChan implements Ch<V> {

	put(msg?: V): Promise<void> {

		const runningPrc = csp.stackHead

		if (!runningPrc) {
			throw new Error(`ribu: can't put outside a process`)
		}

		return new Promise<void>(resolveSender => {

			const { _waitingReceivers } = this

			if (_waitingReceivers.isEmpty) {
				runningPrc._promResolve<void> = resolveSender
				runningPrc._chanPutMsg = msg
				this._waitingSenders.push(runningPrc)
				return
			}

			/* _waitingReceivers is NOT Empty - so cast ok */
			const receiverPrc = _waitingReceivers.pull()    !

			if (receiverPrc._state === "RUNNING") {
				const resolveReceiver = receiverPrc._promResolve    !
				csp.stackHead = receiverPrc
				resolveReceiver(msg)
			}

			csp.stackHead = runningPrc
			resolveSender(undefined)
		})
	}

	get rec(): Promise<V> {

		const runningPrc = csp.stackHead

		if (!runningPrc) {
			throw new Error(`ribu: can't receive outside a process`)
		}

		return new Promise<V>(resolveReceiver => {

			const { _waitingSenders } = this

			if (_waitingSenders.isEmpty) {
				runningPrc._promResolve<V> = resolveReceiver
				this._waitingReceivers.push(runningPrc)
				return
			}

			/* _waitingSenders is NOT Empty - so cast ok */
			const senderPrc = _waitingSenders.pull()    !

			if (senderPrc._state === "RUNNING") {
				const resolveSender = senderPrc._promResolve    !
				csp.stackHead = senderPrc
				resolveSender(undefined)
			}

			csp.stackHead = runningPrc
			const msg = senderPrc._chanPutMsg    as V
			resolveReceiver(msg)
		})
	}
}


export type Ch<V = undefined> = {
	put(msg: V): Promise<void>,
	put(...msg: V extends undefined ? [] : [V]): Promise<void>,
	get rec(): Promise<V>,
}


class BufferedChan<V> extends BaseChan  implements Ch<V> {

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

		return new Promise<void>(resolveSender => {

			const buffer = this.#buffer

			if (buffer.isFull) {
				runningPrc._promResolve<void> = resolveSender
				runningPrc._chanPutMsg = msg
				this._waitingSenders.push(runningPrc)
				return
			}

			const { _waitingReceivers } = this

			buffer.push(msg)
			csp.stackHead = runningPrc
			resolveSender(undefined)

			if (_waitingReceivers.isEmpty) {
				return
			}

			/* _waitingReceivers is NOT Empty - so cast ok */
			const receiverPrc = _waitingReceivers.pull()    !

			if (receiverPrc._state === "RUNNING") {
				const resolveReceiver = receiverPrc._promResolve    !
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

			const { _waitingSenders } = this

			/* buffer is NOT Empty - so cast ok */
			const msg = buffer.pull()    !
			csp.stackHead = runningPrc
			resolveReceiver(msg)

			if (_waitingSenders.isEmpty) {
				return
			}

			/* _waitingSenders is NOT Empty - so cast ok */
			const senderPrc = _waitingSenders.pull()    !

			if (senderPrc._state === "RUNNING") {
				const resolveSender = senderPrc._promResolve    !
				csp.stackHead = senderPrc
				resolveSender(undefined)
			}
		})
	}
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

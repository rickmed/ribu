import { pullOutMsg, run, setPark, setResume } from "./Prc.mjs"
import csp from "./initCsp.mjs"


/**
 * @template [TChVal=undefined]
 * @param {number=} capacity
 */
export function ch(capacity = 0) {
	const _ch = /** @type {Ribu.Ch<TChVal>} */
		(capacity === 0 ? new Chan() : new BufferedChan(capacity))
	return _ch
}


/** @template [TChVal=undefined] */
class BaseChan {

	/** @type ArrayQueue<_Ribu.Prc> @protected */
	_waitingSenders = new ArrayQueue()

	/** @type ArrayQueue<_Ribu.Prc> @protected */
	_waitingReceivers = new ArrayQueue()

	/** @type {_Ribu.Dispatch<TChVal>} */
	dispatch(msg) {
		const waitingReceiver = /** @type {_Ribu.Prc} */ (this._waitingReceivers.pull())
		setResume(waitingReceiver, msg)
		run(waitingReceiver)
	}
}


/** @template [TChVal=undefined] */
class Chan extends BaseChan {

	/** @type {_Ribu.Put<TChVal>} */
	put(msg) {

		const runningPrc = /** @type {_Ribu.Prc} */ (csp.runningPrc)

		const { _waitingReceivers } = this

		if (_waitingReceivers.isEmpty) {
			this._waitingSenders.push(runningPrc)
			return setPark(runningPrc, msg)
		}

		// cast is ok since _waitingReceivers is NOT Empty
		const receiverPrc = /** @type {_Ribu.Prc} */ (_waitingReceivers.pull())
		setResume(receiverPrc, msg)
		csp.schedule(receiverPrc)
		return setResume(runningPrc, undefined)
	}

	/** @return {_Ribu.YIELD_VAL} */
	get rec() {

		const runningPrc = /** @type {_Ribu.Prc} */ (csp.runningPrc)

		const { _waitingSenders } = this

		if (_waitingSenders.isEmpty) {
			this._waitingReceivers.push(runningPrc)
			return setPark(runningPrc, undefined)
		}

		// cast is ok since _waitingSenders is NOT Empty
		const senderPrc = /** @type {_Ribu.Prc} */ (_waitingSenders.pull())
		const msg = pullOutMsg(senderPrc)
		setResume(senderPrc, undefined)
		csp.schedule(senderPrc)
		return setResume(runningPrc, msg)
	}
}


/** @template [TChVal=undefined] */
class BufferedChan extends BaseChan {

	/** @type ArrayQueue<TChVal> */
	#buffer
	isFull

	/** @param {number} capacity */
	constructor(capacity) {
		super()
		const buffer = new ArrayQueue(capacity)
		this.#buffer = buffer
		this.isFull = buffer.isFull
	}

	/** @type {_Ribu.Put<TChVal>} */
	put(msg) {

		const runningPrc = /** @type {_Ribu.Prc} */ (csp.runningPrc)

		const buffer = this.#buffer

		if (buffer.isFull) {
			this._waitingSenders.push(runningPrc)
			return setPark(runningPrc, msg)
		}

		const { _waitingReceivers } = this
		if (_waitingReceivers.isEmpty) {
			buffer.push( /** @type {TChVal} */(msg))
			return setResume(runningPrc, undefined)
		}

		// cast is ok since _waitingReceivers is NOT Empty
		const receiverPrc = /** @type {_Ribu.Prc} */ (_waitingReceivers.pull())
		setResume(receiverPrc, msg)
		csp.schedule(receiverPrc)
		return setResume(runningPrc, undefined)
	}

	/** @return {_Ribu.YIELD_VAL} */
	get rec() {

		const runningPrc = /** @type {_Ribu.Prc} */ (csp.runningPrc)

		const buffer = this.#buffer

		if (buffer.isEmpty) {
			this._waitingReceivers.push(runningPrc)
			return setPark(runningPrc, undefined)
		}

		const { _waitingSenders } = this
		if (_waitingSenders.isEmpty) {
			return setResume(runningPrc, buffer.pull())
		}

		// cast is ok since _waitingSenders is NOT Empty
		const senderPrc = /** @type {_Ribu.Prc} */ (_waitingSenders.pull())
		const msg = pullOutMsg(senderPrc)
		setResume(senderPrc, undefined)
		csp.schedule(senderPrc)
		return setResume(runningPrc, msg)
	}
}


/** @template TVal */
class ArrayQueue {

	/** @type Array<TVal> */
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

	/** @param {TVal} x */
	push(x) {
		this.#array.unshift(x)
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

// 		return listenerCh.rec
// 	}

// 	/** @type {() => _Ribu.YIELD_VAL} */
// 	put() {

// 		const notifyDone = ch()
// 		const listeners = this.#listeners

// 		go(function* _emit() {
// 			if (listeners === undefined) {
// 				yield notifyDone.rec
// 				return
// 			}
// 			if (Array.isArray(listeners)) {
// 				for (const ch of listeners) {
// 					yield ch.put()
// 				}
// 				yield notifyDone.rec
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

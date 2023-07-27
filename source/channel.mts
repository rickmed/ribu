import { go, pullOutMsg, run, setPark, setResume, type Prc, type YIELD_T, YIELD, Yieldable } from "./process.mjs"
import csp from "./initCsp.mjs"


export const DONE = Symbol("ribu chan DONE")


export function ch<V = undefined>(capacity = 0): Ch<V> {
	const _ch = capacity === 0 ? new Chan<V>() : new BufferedChan<V>(capacity)
	return _ch
}

export type Ch<V = undefined> = {
	put(msg: V): ChGen<V>,
   put(...msg: V extends undefined ? [] : [V]): ChGen<V>,
   get rec(): ChGen<V>,
	get isNotDone(): boolean
	close(): void
   dispatch(msg: V): void,
}

type ChGen<V> = Generator<Yieldable, V, unknown>


export class BaseChan<V> {

	protected _waitingSenders = new Queue<Prc>()
	protected _waitingReceivers = new Queue<Prc>()
	protected _closed = false

	close() {
		this._closed = true
	}

	dispatch(msg: V): void {
		// ok to cast. I would throw anyways and the error should be evident
		const waitingReceiver = this._waitingReceivers.pull() as Prc
		setResume(waitingReceiver, msg)
		run(waitingReceiver)
	}

	/* Subclasses below overwrite it.
	 * Placed for "value instanceof BaseChan" in run(prc)
	*/
	get rec() { return YIELD }
}


class Chan<V> extends BaseChan<V> implements Ch<V> {

   *put(msg?: V): YIELD_T {



		// const runningPrc = csp.runningPrc

		// const { _waitingReceivers } = this

		// if (_waitingReceivers.isEmpty) {
		// 	this._waitingSenders.push(runningPrc)
		// 	return setPark(runningPrc, msg)
		// }

		// // cast is ok since _waitingReceivers is NOT Empty
		// const receiverPrc = _waitingReceivers.pull() as Prc
		// setResume(receiverPrc, msg)
		// csp.schedule(receiverPrc)
		// return setResume(runningPrc, undefined)
	}

	get rec(): YIELD_T {

		// const runningPrc = csp.runningPrc

		// const { _waitingSenders } = this

		// if (_waitingSenders.isEmpty) {
		// 	this._waitingReceivers.push(runningPrc)
		// 	return setPark(runningPrc, undefined)
		// }

		// // cast is ok since _waitingSenders is NOT Empty
		// const senderPrc = _waitingSenders.pull() as Prc
		// const msg = pullOutMsg(senderPrc)
		// setResume(senderPrc, undefined)
		// csp.schedule(senderPrc)
		// return setResume(runningPrc, msg)
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

	put(msg?: V): YIELD_T {

		const runningPrc = csp.runningPrc

		const buffer = this.#buffer

		if (buffer.isFull) {
			this._waitingSenders.push(runningPrc)
			return setPark(runningPrc, msg)
		}

		const { _waitingReceivers } = this
		if (_waitingReceivers.isEmpty) {
			buffer.push(msg as V)
			return setResume(runningPrc, undefined)
		}

		// cast is ok since _waitingReceivers is NOT Empty
		const receiverPrc = _waitingReceivers.pull() as Prc
		setResume(receiverPrc, msg)
		csp.schedule(receiverPrc)
		return setResume(runningPrc, undefined)
	}

	get rec(): YIELD_T {

		const runningPrc = csp.runningPrc

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
		const senderPrc = _waitingSenders.pull() as Prc
		const msg = pullOutMsg(senderPrc)
		setResume(senderPrc, undefined)
		csp.schedule(senderPrc)
		return setResume(runningPrc, msg)
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

	pull() {
		return this.#array_m.pop()
	}

	push(x: V) {
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

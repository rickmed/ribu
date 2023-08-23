import { PARK, RESUME } from "./utils.js"
import { chanPutMsg, type Prc, type Gen } from "./process.js"
import { getRunningPrc } from "./initCsp.js"
import { Queue } from "./dataStructures.js"

export type Ch<V = undefined> = _Ch<V>
export function Ch<V = undefined>(): Ch<V> {
	return new _Ch<V>()
}

export function isCh(x: unknown): x is Ch {
	return x instanceof _Ch
}


class BaseChan<V> {

	putQ = new Queue<Prc>()
	recQ = new Queue<Prc>()
	_enQueuedMsgs = new Queue<V>()  // @todo: ???
	closed = false

	close() {
		this.closed = true
	}
}

class _Ch<V = undefined> extends BaseChan<V> {

	/**
	 * Need to use full generator (ie, yield*) instead of just yield, because
	 * typescript can't preserve the types between what is yielded and what is
	 * returned at gen.next()
	 */
	get rec(): Gen<V> {
		return this.#rec()
	}

	*#rec(): Gen<V> {
		const recPrc = getRunningPrc()

		let putPrc = this.putQ.deQ()

		if (!putPrc) {
			this.recQ.enQ(recPrc)
			const msg = yield PARK
			return msg as V
		}

		const {_enQueuedMsgs} = this  //@todo: ??
		if (!_enQueuedMsgs.isEmpty) {
			return _enQueuedMsgs.deQ()!
		}
		else {
			putPrc._resume(undefined)
			const msg = putPrc[chanPutMsg]
			return msg as V
		}
	}

	/**
	 * No need to pay the cost of using yield* because put() returns nothing
	 * within a process, so no type preserving needed.
	 */
	put(msg: V): PARK | RESUME
	put(...msg: V extends undefined ? [] : [V]): PARK | RESUME
   put(msg?: V): PARK | RESUME {

		if (this.closed) {
			throw Error(`can't put() on a closed channel`)
		}

		let putPrc = getRunningPrc()
		let recPrc = this.recQ.deQ()

		if (!recPrc) {
			putPrc[chanPutMsg] = msg
			this.putQ.enQ(putPrc)
			return PARK
		}

		recPrc._resume(msg)
		return RESUME
	}

	get notDone() {
		return this.putQ.isEmpty ? false : true
	}
}

export function addRecPrcToCh(ch: _Ch, prc: Prc): void {
	ch.recQ.enQ(prc)
}


// export function chBuff<V = undefined>(capacity: number) {
// 	return new BufferedCh<V>(capacity)
// }

// export class BufferedCh<V = undefined> extends BaseChan<V> {

// 	#buffer: Queue<V>
// 	isFull: boolean

// 	constructor(capacity: number) {
// 		super()
// 		const buffer = new Queue<V>(capacity)
// 		this.#buffer = buffer
// 		this.isFull = buffer.isFull
// 	}

// 	get rec(): Gen<V> {
// 		return this.#rec()
// 	}

// 	*#rec(): Gen<V> {
// 		const recPrc = getRunningPrc()

// 		const buffer = this.#buffer
// 		const msg = buffer.deQ()

// 		if (msg === undefined) {
// 			this.recQ.enQ(recPrc)
// 			const msg = yield PARK
// 			return msg as V
// 		}

// 		const putPrc = this.putQ.deQ()

// 		if (putPrc) {
// 			buffer.enQ(putPrc[chanPutMsg] as V)
// 			putPrc._resume(undefined)
// 		}

// 		return msg
// 	}

// 	put(msg: V): PARK | RESUME {

// 		if (this.closed) {
// 			throw Error(`ribu: can't put on a closed channel`)
// 		}

// 		let putPrc = getRunningPrc()

// 		const buffer = this.#buffer

// 		if (buffer.isFull) {
// 			putPrc[chanPutMsg] = msg
// 			this.putQ.enQ(putPrc)
// 			return PARK
// 		}

// 		const {recQ: _waitingReceivers} = this
// 		let recPrc = _waitingReceivers.deQ()

// 		if (!recPrc) {
// 			buffer.enQ(msg as V)
// 			putPrc._resume(undefined)
// 			return RESUME
// 		}

// 		while (recPrc) {
// 			if (recPrc.#state === "RUNNING") {
// 				recPrc._resume(msg)
// 				break
// 			}
// 			recPrc = _waitingReceivers.deQ()
// 		}
// 		return RESUME
// 	}

// 	get notDone() {
// 		return this.#buffer.isEmpty && this.putQ.isEmpty ? false : true
// 	}
// }

import { PARK, RESUME, UNSET } from "./shared.js"
import { type Prc, type Gen } from "./process.js"
import { getRunningPrcOrThrow } from "./initCsp.js"
import { Queue } from "./dataStructures.js"

export type Ch<V = undefined> = _Ch<V>
export function Ch<V = undefined>(): Ch<V> {
	return new _Ch<V>()
}

export function chBuff<V = undefined>(capacity: number) {
	return new BufferedCh<V>(capacity)
}


class BaseChan<V> {

	protected _waitingPutters = new Queue<Prc>()
	_waitingReceivers = new Queue<Prc>()
	protected _enQueuedMsgs = new Queue<V>()
	protected _closed = false

	close() {
		this._closed = true
	}
}

class _Ch<V = undefined> extends BaseChan<V> {

	_resolvedVal: V | UNSET = UNSET

	/**
	 * Need to use full generator, ie, yield*, instead of just yield, because
	 * typescript can't preserve the types between what is yielded and what is
	 * returned at gen.next()
	 */
	get rec(): Gen<V> {
		return this.#rec()
	}

	*#rec(): Gen<V> {
		const recPrc = getRunningPrcOrThrow(`can't receive outside a process.`)

		const { _resolvedVal } = this
		if (_resolvedVal !== UNSET) {
			this._resolvedVal = UNSET
			return _resolvedVal
		}

		let putPrc = this._waitingPutters.deQ()

		if (!putPrc) {
			this._waitingReceivers.enQ(recPrc)
			const msg = yield PARK
			return msg as V
		}

		const {_enQueuedMsgs} = this
		if (!_enQueuedMsgs.isEmpty) {
			return _enQueuedMsgs.deQ()!
		}
		else {
			putPrc._resume()
			const msg = putPrc._chanPutMsg_m
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

		if (this._closed) {
			throw Error(`can't put() on a closed channel`)
		}

		const putPrc = getRunningPrcOrThrow(`can't put outside a process.`)
		let recPrc = this._waitingReceivers.deQ()

		if (!recPrc) {
			putPrc._chanPutMsg_m = msg
			this._waitingPutters.enQ(putPrc)
			return PARK
		}

		recPrc._resume(msg)
		return RESUME
	}

	get notDone() {
		return this._waitingPutters.isEmpty ? false : true
	}

	resumeAll(msg: V): void {
		const {_waitingReceivers} = this
		while (!_waitingReceivers.isEmpty) {
			const recPrc = _waitingReceivers.deQ()!
			recPrc._resume(msg)
		}
		_waitingReceivers.clear()
	}

	resolve(msg: V): this {
		this._resolvedVal = msg
		return this
	}
}

export function addReceiver(ch: _Ch, prc: Prc): void {
	ch._waitingReceivers.enQ(prc)
}

export class BufferedCh<V = undefined> extends BaseChan<V> {

	#buffer: Queue<V>
	isFull: boolean

	constructor(capacity: number) {
		super()
		const buffer = new Queue<V>(capacity)
		this.#buffer = buffer
		this.isFull = buffer.isFull
	}

	get rec(): Gen<V> {
		return this.#rec()
	}

	*#rec(): Gen<V> {
		const recPrc = getRunningPrcOrThrow(`can't receive outside a process.`)

		const buffer = this.#buffer
		const msg = buffer.deQ()

		if (msg === undefined) {
			this._waitingReceivers.enQ(recPrc)
			const msg = yield PARK
			return msg as V
		}

		const putPrc = this._waitingPutters.deQ()

		if (putPrc) {
			buffer.enQ(putPrc._chanPutMsg_m as V)
			putPrc._resume()
		}

		return msg
	}

	put(msg: V): PARK | RESUME {

		if (this._closed) {
			throw Error(`ribu: can't put on a closed channel`)
		}

		const putPrc = getRunningPrcOrThrow(`can't put outside a process.`)

		const buffer = this.#buffer

		if (buffer.isFull) {
			putPrc._chanPutMsg_m = msg
			this._waitingPutters.enQ(putPrc)
			return PARK
		}

		const {_waitingReceivers} = this
		let recPrc = _waitingReceivers.deQ()

		if (!recPrc) {
			buffer.enQ(msg as V)
			putPrc._resume()
			return RESUME
		}

		while (recPrc) {
			if (recPrc._state === "RUNNING") {
				recPrc._resume(msg)
				break
			}
			recPrc = _waitingReceivers.deQ()
		}
		return RESUME
	}

	get isNotDone() {
		return this.#buffer.isEmpty && this._waitingPutters.isEmpty ? false : true
	}
}

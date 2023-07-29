import { Prc, type Gen, go } from "./process.mjs"
import { getRunningPrcOrThrow } from "./initCsp.mjs"
import { Queue } from "./dataStructures.mjs"


export const DONE = Symbol("ribu chan DONE")


export function ch<V = undefined>(capacity = 0): Ch<V> {
	const _ch = capacity === 0 ? new Chan<V>() : new BufferedChan<V>(capacity)
	return _ch
}

export type Ch<V = undefined> = {
   get rec(): Gen<V>,
	put(msg: V): "PARK" | "RESUME",
   put(...msg: V extends undefined ? [] : [V]): "PARK" | "RESUME",
	get isNotDone(): boolean
	close(): void
   enQueue(msg: V): void,
}


export class BaseChan<V> {

	protected _waitingPutters = new Queue<Prc>()
	protected _waitingReceivers = new Queue<Prc>()
	protected _enQueuedMsgs = new Queue<V>()
	protected _closed = false

	close() {
		this._closed = true
	}

	/** @todo: I think this should broadcast msg instead of deQueuing, ie, sending a different msg to each waitingRec */
	enQueue(msg: V): void {
		if (this._closed) {
			throw Error(`ribu: can't enQueue() on a closed channel.`)
		}
		const receiverPrc = this._waitingReceivers.deQ()
		if (!receiverPrc) {
			this._enQueuedMsgs.enQ(msg)
			return
		}
		receiverPrc._resume(msg)
	}
}


class Chan<V> extends BaseChan<V> implements Ch<V> {

	/**
	 * Need to use full generator, ie, yield*, instead of just yield, because
	 * typescript can't preserve the types between what is yielded and what is
	 * returned at gen.next()
	 */
	get rec(): Gen<V> {
		const receiverPrc = getRunningPrcOrThrow(`can't receive outside a process.`)
		return this.#rec(receiverPrc)
	}

	*#rec(receiverPrc: Prc): Gen<V> {
		let putterPrc = this._waitingPutters.deQ()

		if (!putterPrc) {
			this._waitingReceivers.enQ(receiverPrc)
			const msg = yield "PARK"
			return msg as V
		}

		const {_enQueuedMsgs} = this
		if (!_enQueuedMsgs.isEmpty) {
			return _enQueuedMsgs.deQ()!
		}

		else {
			putterPrc._resume()
			const msg = putterPrc._chanPutMsg_m
			return msg as V
		}
	}

	/**
	 * No need to pay the cost of using yield* because put() returns nothing
	 * within a process, so no type preserving needed.
	 */
   put(msg?: V): "PARK" | "RESUME" {

		if (this._closed) {
			throw Error(`can't put() on a closed channel`)
		}

		const putterPrc = getRunningPrcOrThrow(`can't put outside a process.`)
		let receiverPrc = this._waitingReceivers.deQ()

		if (!receiverPrc) {
			this._waitingPutters.enQ(putterPrc)
			return "PARK"
		}

		receiverPrc._resume(msg)
		return "RESUME"
	}

	get isNotDone() {
		return this._waitingPutters.isEmpty ? false : true
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

	get rec(): Gen<V> {
		const receiverPrc = getRunningPrcOrThrow(`can't receive outside a process.`)
		return this.#rec(receiverPrc)
	}

	*#rec(receiverPrc: Prc): Gen<V> {

		const buffer = this.#buffer
		const msg = buffer.deQ()

		if (msg === undefined) {
			this._waitingReceivers.enQ(receiverPrc)
			const msg = yield "PARK"
			return msg as V
		}

		const putterPrc = this._waitingPutters.deQ()

		if (putterPrc) {
			buffer.enQ(putterPrc._chanPutMsg_m as V)
			putterPrc._resume()
		}

		return msg
	}

	put(msg?: V): "PARK" | "RESUME" {

		if (this._closed) {
			throw Error(`ribu: can't put on a closed channel`)
		}

		const putterPrc = getRunningPrcOrThrow(`can't put outside a process.`)

		const buffer = this.#buffer

		if (buffer.isFull) {
			putterPrc._chanPutMsg_m = msg
			this._waitingPutters.enQ(putterPrc)
			return "PARK"
		}

		const {_waitingReceivers} = this
		let receiverPrc = _waitingReceivers.deQ()

		if (!receiverPrc) {
			buffer.enQ(msg as V)
			putterPrc._resume()
			return "RESUME"
		}

		while (receiverPrc) {
			if (receiverPrc._state === "RUNNING") {
				receiverPrc._resume(msg)
				break
			}
			receiverPrc = _waitingReceivers.deQ()
		}
		return "RESUME"
	}

	get isNotDone() {
		return this.#buffer.isEmpty && this._waitingPutters.isEmpty ? false : true
	}
}


/* ===  Helpers  ==================================================== */

export function all(...chanS: Ch[]): Ch {

	const allDone = ch()
	const chansL = chanS.length
	const notifyDone = ch(chansL)

	for (const chan of chanS) {
		go(function* _all() {
			yield* chan.rec
			yield notifyDone.put()
		})
	}

	go(function* _collectDones() {
		let nDone = 0
		while (nDone < chansL) {
			yield* notifyDone.rec
			nDone++
		}
		yield allDone.put()
	})

	return allDone
}

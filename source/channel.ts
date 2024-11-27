import { type Job } from "./job.js"
import { TheIterable, theIterable, runningJob } from "./system.js"
import { Queue } from "./data-structures.js"

// todo: if job is done, skip in putters/receivers queue.

export type Ch<V = undefined> = _Ch<V>
export function Ch<V = undefined>(): Ch<V> {
	return new _Ch<V>()
}

export function isCh(x: unknown): x is Ch {
	return x instanceof _Ch
}


class BaseChan<V> {

	puttersQ = new Queue<Job>()	
	receiversQ = new Queue<Job>()
	_enQueuedMsgs = new Queue<V>()  // @todo: ???
	closed = false

	close() {
		this.closed = true
	}
}

export class _Ch<V = undefined> extends BaseChan<V> {

	get rec() {
		let recJob = runningJob()
		let putJob = this.puttersQ.deQ()

		if (!putJob) {
			this.receiversQ.enQ(recJob)
			recJob._setPark()
		}
		else {
			const putMsg = putJob._io
			putJob._resume()
			recJob._setResume(putMsg)
		}
		return theIterable as TheIterable<V>
	}

	put(msg: V): TheIterable<V>
	put(...msg: V extends undefined ? [] : [V]): TheIterable<V>
	put(msg?: V): TheIterable<V> {
		// @todo
		// if (this.closed) {
		// 	throw Error(`can't put() on a closed channel`)
		// }

		let putJob = runningJob()
		let recJob = this.receiversQ.deQ()

		if (!recJob) {
			this.puttersQ.enQ(putJob)
			putJob._setPark(msg)
		}
		else {
			recJob._resume(msg)
			putJob._setResume()
		}
		return theIterable as TheIterable<V>
	}

	get notDone() {
		return this.puttersQ.isEmpty ? false : true
	}
}

export function addRecPrcToCh(ch: _Ch, prc: Job): void {
	ch.receiversQ.enQ(prc)
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

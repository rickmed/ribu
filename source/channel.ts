import { PARK, RESUME } from "./utils.js"
import { IOmsg, type Prc, type Gen } from "./process.js"
import { csp } from "./initCsp.js"
import { Queue } from "./dataStructures.js"

export type Ch<V = undefined> = _Ch<V>
export function Ch<V = undefined>(): Ch<V> {
	return new _Ch<V>()
}

export function isCh(x: unknown): x is Ch {
	return x instanceof _Ch
}


class BaseChan<V> {

	puttersQ = new Queue<Prc>()
	receiversQ = new Queue<Prc>()
	_enQueuedMsgs = new Queue<V>()  // @todo: ???
	closed = false

	close() {
		this.closed = true
	}
}


/* this iterator object can be shared by all yield ops (need to convert to yield*)
	- so that {done, value} obj is shared.
	sleep, put, etc...
*/

// msg in iterator.next(msg) is _resume(msg) -> gen.next(msg)
// except when yield* is first called, then the arg will NOT be forwarded.
// if iterator.next() returns {done: true}, is "consumed" by yield* (only uses .value prop)
// ie, interpreter will not see it never.

// State machine instead of communicating by yielded values

let iterRes = {
	done: false,
	value: 0 as unknown,
}

type IterRes = typeof iterRes
type X = Iterable<boolean>

const iterator = {
	next(): IterRes {
		const currentOp = csp.currentOp
		const opVal = csp.currentOpV
		switch (currentOp) {
			case "chRec": return chRec(opVal as Ch)
			case "chPut": return chPut(opVal as Ch)
			default: throw new Error(`${currentOp satisfies never} is not known`)
		}
	}
}


const iterable = {
	[Symbol.iterator](): Iterator<V> {
		return iterator
	}
}


type _Iterable<V> = {
	[Symbol.iterator](): Iterator<V>
}

export class _Ch<V = undefined> extends BaseChan<V> {

	get rec() {
		csp.currentOp = "chRec"
		csp.currentOpV = this
		return iterable as _Iterable<V>
	}

	put(msg: V): _Iterable<V>
	put(...msg: V extends undefined ? [] : [V]): _Iterable<V>
	put(msg?: V): _Iterable<V> {
		csp.currentOp = "chPut"
		csp.currentOpV = this
		csp.runningPrc[IOmsg] = msg
		return iterable as _Iterable<V>
	}

	get notDone() {
		return this.puttersQ.isEmpty ? false : true
	}
}

function chRec(ch: Ch): IterRes {
	const recPrc = csp.runningPrc

	let putPrc = ch.puttersQ.deQ()

	if (!putPrc) {
		ch.receiversQ.enQ(recPrc)
		// .value doesn't matter because it's ignored by yield* and _resume(),
		// ie, prc will be parked.
		iterRes.done = false
		return iterRes
	}

	const msg = putPrc[IOmsg]
	csp.currentOp = "chPut"  // since this.next() will be called on _resume()
	putPrc._resume()
	iterRes.done = true
	iterRes.value = msg
	return iterRes
}

function chPut(ch: Ch): IterRes {
	if (ch.closed) {  // @todo
		throw Error(`can't put() on a closed channel`)
	}

	// I can be called directly from prc or resumed by chRec()
		// maybe a state in ch ?

	let putPrc = getRunningPrc()
	let recPrc = ch.receiversQ.deQ()

	if (!recPrc) {
		putPrc[IOmsg] = msg
		ch.puttersQ.enQ(putPrc)
		return PARK
	}

	recPrc._resume(msg)
	return RESUME
}


export function addRecPrcToCh(ch: _Ch, prc: Prc): void {
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

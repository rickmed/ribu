import { status, type Prc, IOmsg } from "./process.js"


export class System {
	deadline = 5000
	prcStack: Array<Prc> = []

	get runningPrc() {
		return this.prcStack.at(-1)
	}
}

export const sys = new System()

export function getRunningPrc() {
	const prc = sys.runningPrc
	if (!prc) {
		throw Error(`ribu: no process running`)
	}
	return prc
}


export let iterRes = {
	done: false,
	value: 0 as unknown,
}


/*

a Prc can have +1 Observers (interested in different things), eg:
	- one prc waiting for result and another waiting for cancel() to be done

	cancel() could resume receiver with its doneVal:
		doesn't matter bc in theory cancel() doesn't return anything anyway
*/


/*
this guy is finally the one who decides if the calling|running prc:
	- park (return {done: false}) or
	- resume (return {done: true, value: ??})

	next() could be called with the receiving prc, so iterator.next() can
	just return {value: nextArg[IOmsg]}

	resume() -> gen.next(this)   "this" is the just resumed prc
		// can't be the IOmsg itself bc it could be undefined just as the first
		// iterator.next() call on yield*

	this next(arg) could do (if arg !== undefined):
		this only means the prc is being resumed, so the status of what val
		to be resumed with could set up prior the [iterator.Symbol]() call
		(since prc.status won't used there)
		ok that is how I use only one iterator.

	=> so the resumer needs to place the right value in observer[IOmsg]

	what should resumer call observer.resume(??) with?

	problem is that observed shouldn't be concered of what type of value
	the observer is resumed with.

*/
export const theIterator = {
	next(): IteratorResult<unknown> {
		const runningPrc = getRunningPrc()
		const runningStatus = runningPrc[status]
		if (runningStatus === "PARK") {
			iterRes.done = false
			// can leave same iterRes.value because will be ignored by yield* and resume()
			return iterRes
		}
		iterRes.done = true
		iterRes.value = runningPrc[IOmsg]
		return iterRes
	}
}


export type TheIterable<V> = {
	[Symbol.iterator](): Iterator<unknown, V>
}

export const theIterable: TheIterable<unknown> = {
	[Symbol.iterator]() {
		return theIterator
	}
}

import { Job, continueRunningJob, iter, type Iterable } from "./job.ts"
import { sys, Iter, iterRes, EMPTY } from "./shared.ts"

// channel resumes job if job._state != DONE
// else, it skips it and pulls another one
// ie, a blocked job in rec should be skipped (since wont do anything witl the msg)
// but a blocked job in put, the receveing job should take out its msg from _io

// Optimization: lots of Channels are to send only one msg,
// so only instantiate internal queue at second queued msg.

export function Ch<V = undefined>(): Chan<V> {
	return new Chan<V>()
}

export function isCh(x: unknown): x is Chan {
	return x instanceof Chan
}

type PutVal<V> = V extends undefined ? void : V

// todo, type for unclosable channel

export interface OutCh<in V> {
	put: (msg: PutVal<V>) => Iterable<undefined>
	enQ: (msg: PutVal<V>) => void
}

type InCh<out V> = {
	rec: Iterable<V>
}

const REC = 0
const PUT = 1
let op: typeof REC | typeof PUT = PUT
let putMsg: unknown = EMPTY

type Receivers = typeof EMPTY | Linkable | Queue<Linkable>

/*

** Jobs and Chan checks before .onObservableDone(val) if observer is
	Select, so it puts itself on system variable

** Could implement "buffered" channels by:
	ch.enQ(1)
	ch.enQ(2)
	check (ch.size === 3)
	yield* ch.put(3)

*/
export class Chan<V = undefined> implements OutCh<V>, InCh<V> {

	// unknown value inserted by enQueue
	putterS: unknown = EMPTY  // Queue<Job | unknown> | Job | unknown
	receiverS: Receivers = EMPTY
	_done = false

	done() {
		this._done = true
	}

	// todo: skip if job is !blocked (done, cancelling,...)
	get rec() {
		op = REC
		// needs to return blockJobIterable as TheIterable<typeof this.val>
		// so that caller can't call .put() on it after it called .rec and vice versa
		return this as Iterable<V>
	}

	put(msg: PutVal<V>): Iterable<undefined> {
		throwIfDone<V>(this)
		op = PUT
		putMsg = msg
		return this as Iterable<undefined>
	}

	[Symbol.iterator]() {
		if (op == REC) {
			processRec(this)
		}
		else {
			processPut(this)
		}
		return iter as Iter<V>
	}

	enQ(msg: PutVal<V>) {
		throwIfDone<V>(this)
		putMsg = msg
		processPut(this)
		return this
	}

	// there maybe values in queue by putter jobs waiting or inserted by enQueue
	get notDone() {
		// todo
		return null
	}

}

export function enQueue<V>(ch: Chan<V>, msg: PutVal<V>): void {
	ch.enQ(msg)
}

function throwIfDone<V>(ch: Chan<V>) {
	if (ch._done) {
		throw Error(`can't put() on a closed channel`)
	}
}

const RECS = "receiverS"
type Recs = typeof RECS
const PUTS = "putterS"
type Puts = typeof PUTS
type KOfawaiterS = Recs | Puts

function processRec<V>(ch_m: Chan<V>) {
	const { putterS } = ch_m

	if (putterS == EMPTY) {
		receiverHasNoPutter(ch_m)
		return
	}
	if (putterS instanceof Job) {
		ch_m.putterS = EMPTY
		resumeObserverAndMe(putterS, undefined, putterS.val)
		return
	}
	if (putterS instanceof Queue) {
		const putVal: unknown = putterS.deQ()
		return putVal == EMPTY ?
			receiverHasNoPutter(ch_m) :
			putVal instanceof Job ?
				resumeObserverAndMe(putVal, undefined, putVal.val) :
				continueRunningJob(putVal)  // a value inserted by .enQueue()
	}

	// a sole value inserted by .enQueue()
	continueRunningJob(putterS)
}

function receiverHasNoPutter<V>(ch: Chan<V>) {
	addAsWaiter(sys.runningJob, ch, RECS)
	iterRes.done = false
}

export function addAsWaiter<V>(value: Receivers, hasAwaiterS_m: Chan<V>, kOfawaiterS: Recs): void
export function addAsWaiter<V>(value: unknown, hasAwaiterS_m: Chan<V>, kOfawaiterS: Puts): void
export function addAsWaiter<V>(value: unknown, hasAwaiterS_m: Chan<V>, kOfawaiterS: KOfawaiterS): void {
	const awaiterS = hasAwaiterS_m[kOfawaiterS]
	if (awaiterS === EMPTY) {
		hasAwaiterS_m[kOfawaiterS] = value as (typeof kOfawaiterS extends Puts ? unknown : Receivers)
	}
	else if (awaiterS instanceof Queue) {
		awaiterS.enQ(value)
	}
	else {
		const queue = new Queue()
		queue.enQ(awaiterS).enQ(value)
		hasAwaiterS_m[kOfawaiterS] = queue as (typeof kOfawaiterS extends Puts ? unknown : Queue<Linkable>)
	}
}

function resumeObserverAndMe(observer: Linkable, msgToObserver: unknown, msgToRunningJob: unknown) {
	//.onTgDone() checks job.state, sets iterRer and .resumes() gen.next()
	observer._onTgDone(msgToObserver)
	// I think same here
	continueRunningJob(msgToRunningJob)
}


function processPut<V>(ch_m: Chan<V>) {

	const { receiverS } = ch_m

	if (receiverS == EMPTY) {
		putterHasNoReceiver(ch_m)
		return
	}
	if ("onObservableDone" in receiverS) {
		ch_m.receiverS = EMPTY
		resumeObserverAndMe(receiverS, putMsg, undefined)
		return
	}

	const receiver = receiverS.deQ()

	if (receiver == EMPTY) {
		putterHasNoReceiver(ch_m)
		return
	}

	resumeObserverAndMe(receiver, putMsg, undefined)
}


function putterHasNoReceiver<V>(ch: Chan<V>) {
	addAsWaiter<V>(sys.runningJob, ch, PUTS)
	iterRes.done = false
}

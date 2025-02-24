import { Job, continueRunningJob, parkRunningJob, type TheIterable } from "./job.ts"
import { sys } from "./system.ts"
import { Queue } from "./data-structures.ts"
import { Select } from "./job-helpers.ts"
import { EMPTY, Observer } from "./shared.ts"

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

export interface OutCh<in V> {
	put: (msg: V extends undefined ? void : V) => TheIterable<undefined>
	enQueue: (msg: V extends undefined ? void : V) => void
}


interface InCh<out V> {
	rec: TheIterable<V>
}


const REC = 0
const PUT = 1
let op: typeof REC | typeof PUT = PUT
let putMsg: unknown = EMPTY

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

	putters: unknown = EMPTY  // Queue<Job | unknown> | Job | unknown
	receivers: typeof EMPTY | Observer | Queue<Observer> = EMPTY
	_done = false

	done() {
		this._done = true
	}

	// todo: skip if job is !blocked (done, cancelling,...)
	get rec() {
		op = REC
		return this as TheIterable<V>
	}

	put(msg: V extends undefined ? void : V): TheIterable<undefined> {
		throwIfDone<V>(this)
		op = PUT
		putMsg = msg
		return this as TheIterable<undefined>
	}

	[Symbol.iterator]() {
		return op === REC ?
			processRec(this) :
			processPut(this)
	}

	enQueue(msg: V extends undefined ? void : V) {
		throwIfDone<V>(this)
		putMsg = msg
		processPut(this)
	}

	// there maybe values in queue by putter jobs waiting or inserted by enQueue
	get notDone() {
		// todo
	}

	isReady() {

	}
}

function throwIfDone<V>(ch: Chan<V>) {
	if (ch._done) {
		throw Error(`can't put() on a closed channel`)
	}
}

const RECS = "receivers"
const PUTS = "putters"
type MaybeQueueK = typeof RECS | typeof PUTS

function processRec<V>(ch_m: Chan<V>) {
	const { putters } = ch_m

	if (putters == EMPTY) {
		return receiverHasNoPutter(ch_m)
	}
	if (putters instanceof Job) {
		ch_m.putters = EMPTY
		return counterpartIsObserver(putters, undefined, putters._io)
	}
	if (putters instanceof Queue) {
		const putVal: unknown = putters.deQ()
		return putVal == EMPTY ?
			receiverHasNoPutter(ch_m) :
			putVal instanceof Job ?
				counterpartIsObserver(putVal, undefined, putVal._io) :
				continueRunningJob(putVal)  // a value inserted by .enQueue()
	}

	// a sole value inserted by .enQueue()
	return continueRunningJob(putters)
}

function receiverHasNoPutter(ch: Chan) {
	addToItsMaybeQueue(ch, RECS, sys.runningJob)
	return parkRunningJob()
}

export function addToItsMaybeQueue(withMaybeQ_m: Chan, kToAddVal: MaybeQueueK, value: unknown) {
	const maybeQueueVal = withMaybeQ_m[kToAddVal]
	if (maybeQueueVal === EMPTY) {
		withMaybeQ_m[kToAddVal] = value
	}
	else if (maybeQueueVal instanceof Queue) {
		maybeQueueVal.enQ(value)
	}
	else {
		const newQueue = new Queue()
		newQueue.enQ(maybeQueueVal)
		newQueue.enQ(value)
		withMaybeQ_m[kToAddVal] = newQueue
	}
}

function counterpartIsObserver(observer: Observer, msgToCounterPart: unknown, msgToRunningJob: unknown) {
	observer.onObservableDone(msgToCounterPart)
	return continueRunningJob(msgToRunningJob)
}


function processPut<V>(ch: Chan<V>) {
	const { receivers } = ch
	if (receivers == EMPTY || "onObservableDone" in receivers) {
		return _processPut(ch, receivers)
	}

	const receiver = receivers.deQ()
	return _processPut(ch, receiver)
}


function _processPut<V>(ch_m: Chan<V>, receiver: typeof EMPTY | Observer) {
	if (receiver == EMPTY) {
		return putterHasNoReceiver(ch_m)
	}

	ch_m.receivers = EMPTY
	return counterpartIsObserver(receiver, putMsg, undefined)
}

function putterHasNoReceiver(ch: Chan) {
	addToItsMaybeQueue(ch, PUTS, sys.runningJob)
	return parkRunningJob()
}





export function enQueue<V>(ch: Chan<V>, msg: V): void {
	ch.enQueue(msg)
}

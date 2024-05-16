import { ArrSet, Events } from "./dataStructures.mjs"
import { RibuE, ECancOK, Err, isRibuE } from "./errors.mjs"
import { runningJob, sys, theIterator } from "./system.mjs"

/* Helpers */
const GenFn = (function* () { }).constructor

function isGenFn(x: unknown): x is RibuGenFn {
	return x instanceof GenFn
}

// todo: maybe change to symbol
export const PARKED = "PARKED"
const YIELD_CANCEL = Symbol("c")

/* observe-resume model:

	- Things subscribe to job._on(EV.JOB_DONE, cb) event when want to be notified
	when observingJob is done.

	- Jobs observing other jobs (yield*) insert cb :: (jobDone) => observer._resume()
		- There's no way for user to stop observing a job.
			- When yield* job.cancel() is called and additional observer is added,
			and the other observers (yield* job.$) are resumed when job settles
			(with CancOK|Errors in this case)

	- Cancellation (and removal of things I'm observing)
		- Set callbacks (eg: setTimeout) need to be removed on cancellation
			(as opposed of cb being "() => if job === DONE; return")
		bc, eg, nodejs won't end process if timeout cb isn't cleared.

	- Channels:
		- Removing a job from within a queue is expensive, so channel checks
		if job === DONE and skips it (removed from queue and not resumed)
*/

/* Internals:

- Things IO/Comms model:
	- job.resume(IOmsg) to have job receive some value and act on it
	- set job.val = IOmsg to whichever observer to consume.


- When yield* is called, [Symbol.iterator]() which returns the iterable,
	- iterable.next() is called
		.next() checks if iterable is "PARK" and returns {done: false}
			- or {done: true, value: iterable.val}

*/
type NotErrs<Ret> = Exclude<Ret, RibuE>
type OnlyErrs<Ret> = Extract<Ret, Error>

export function go<Args extends unknown[], Ret>(genFn: RibuGenFn<Ret, Args>, ...args: Args) {
	const gen = genFn(...args)
	return new Job<NotErrs<Ret>, OnlyErrs<Ret> | ECancOK | Err>(gen, genFn.name, true)
}


/***  Job class  ***/

/* Events names */
const EV = {
	JOB_DONE: "job.done",
	JOB_DONE_WAITCHILDS: "job.done.waitChilds"
} as const


/* Types */
type Yieldable =
	typeof PARKED |
	typeof YIELD_CANCEL |
	Promise<unknown>

export type Gen<Ret = unknown, Rec = unknown> =
	Generator<Yieldable, Ret, Rec>

export type RibuGenFn<Ret = unknown, Args extends unknown[] = unknown[]> =
	(...args: Args) => Generator<Yieldable, Ret>

type OnEnd =
	(() => unknown) | (() => Promise<unknown>) |
	Disposable | AsyncDisposable | RibuGenFn

type State = "RUNNING" | "PARKED" | "BLOCKED_$" | "BLOCKED_cont" | "WAITING_CHILDS" | "CANCELLING" | "DONE"

export class Job<Ret = unknown, Errs = unknown> extends Events {

	_io: Ret | Errs = "$dummy" as (Ret | Errs)
	_gen: Gen
	_name: string
	_state: State = "RUNNING"
	_childs?: ArrSet<Job<Ret>>
	_parent?: Job
	_sleepTO?: NodeJS.Timeout
	_onEnds?: OnEnd | OnEnd[]

	constructor(gen: Gen, genFnName: string, withParent?: boolean) {
		super()
		this._gen = gen
		this._name = genFnName
		if (withParent) {
			this.#addAsChild()
		}
		this._resume()
	}

	get val() {
		return this._io
	}

	#addAsChild() {
		let parent = sys.running
		if (!parent) {
			return
		}
		let parentCs = parent._childs
		if (!parentCs) {
			parent._childs = parentCs = new ArrSet()
		}
		parentCs.add(this)
		this._parent = parent
	}

// difference is that wait targeJob is always async (different stack)
	// unless sync which returns the iterator {done: true}, immediately

// cancelCont:
	// targetJob is not done, can't know if cancel will be sync or async (thus cb)
	// need a way to resume callerJob

	_resume(IOval?: unknown): void {
		sys.stack.push(this)
		this._setResume(IOval)

		try {
			// eslint-disable-next-line no-var
			var yielded = this._gen.next()
		}
		catch (e) {
			this._io = new Err(e, this._name) as Ret
			this._endProtocol()
			return
		}

		sys.stack.pop()

		if (yielded.value === PARKED) {
			this._state = PARKED
			return
		}

		if (yielded.value === YIELD_CANCEL) {
			execCancel()
		}

		if (yielded.done) {
			this.#genFnReturned(yielded.value as Ret)
		}
	}

	_setResume(IOval?: unknown) {
		this._state = "RUNNING"
		this._io = IOval as Ret
	}

	_setPark(IOval?: unknown) {
		this._state = "PARKED"
		this._io = IOval as Ret
	}

	#genFnReturned(yieldedVal: Ret) {
		const settleVal = this._io = yieldedVal
		if (isRibuE(settleVal) && settleVal._op === "") {
			// @ts-ignore ._op readonly
			settleVal._op = this._name
			this._endProtocol()
			return
		}
		if (settleVal instanceof Error) {
			this._io = new Err(settleVal, this._name) as Ret
			this._endProtocol()
			return
		}
		if (this._childs?.size) {
			this.#waitChilds()
		}
		else {
			this._endProtocol()
		}
	}

	#waitChilds() {

		this._state = "WAITING_CHILDS"
		const childs = this._childs!
		const me = this

		let nChilds = childs.size
		let nChildsDone = 0

		for (let i = 0; i < nChilds; i++) {
			const job = childs.arr_m[i]
			if (job) {
				job._on(EV.JOB_DONE_WAITCHILDS, cb)
			}
		}

		function cb(childDone: Job) {
			++nChildsDone
			if (childDone.val instanceof Error) {
				me._removeWaitChildsCBs()
				me._io = new Err(childDone.val, me._name) as Ret
				me._endProtocol()
				return
			}
			if (nChildsDone === nChilds) {
				me._endProtocol()
			}
		}

	}

	_removeWaitChildsCBs() {
		const cs = this._childs!
		const csL = cs.size
		for (let i = 0; i < csL; i++) {
			const job = cs.arr_m[i]
			if (job) {
				job._removeEvCBs(EV.JOB_DONE_WAITCHILDS)
			}
		}
	}

	_onDone(cb: (job: this) => void) {
		this._on(EV.JOB_DONE, cb)
	}

	get orEnd() {
		return this.$
	}

	get $() {
		this.#prepSystem("BLOCKED_$")
		return waitJobIterable as RibuIterable<Ret>
	}

	get cont() {
		this.#prepSystem("BLOCKED_cont")
		return waitJobIterable as RibuIterable<typeof this._io>
	}

	#prepSystem(state: "BLOCKED_$" | "BLOCKED_cont") {
		runningJob()._state = state
		sys.callerJob = runningJob()
		sys.targetJob = this
	}

	/**
	 * Fails caller if result is other than ECancOK
	 */
	cancel(): typeof YIELD_CANCEL {
		sys.callerJob = runningJob()
		sys.targetJob = this
		return YIELD_CANCEL
	}

	_endProtocol() {
		const { _childs, _sleepTO, _onEnds } = this
		let onEndErrs: Error[] | undefined

		if (_sleepTO) {
			clearTimeout(_sleepTO)
		}

		if (!(_onEnds || (_childs && _childs.size > 0))) {
			this.#settle()
			return
		}

		const me = this
		let nWaiting = 0
		let nDone = 0

		// cancel active children
		if (_childs) {
			nWaiting += _childs.size
			const { arr_m } = _childs
			const len = arr_m.length
			for (let i = 0; i < len; i++) {
				const childJob = arr_m[i]
				if (childJob) {
					childJob._endProtocol()
					childJob._on(EV.JOB_DONE, _onJobDone)
				}
			}
		}

		if (_onEnds) {
			if (Array.isArray(_onEnds)) {
				const len = _onEnds.length
				for (let i = len - 1; i >= 0; i--) {  // last set, first called.
					execEnd(_onEnds[i]!)
				}
			}
			else {
				execEnd(_onEnds)
			}
		}

		function execEnd(x: OnEnd): void {
			++nWaiting
			if (isGenFn(x)) {
				new Job(x(), x.name)._on(EV.JOB_DONE, _onJobDone)
			}
			else if (x instanceof Function) {
				const ret = tryFn(x)
				if (isProm(ret)) {
					ret.then(() => onDone(), e => onDone(wrapIfNotError(e)))
					return
				}
				// todo
				onDone(ret)
			}
			else if (Symbol.dispose in x) {
				const disposeFn = x[Symbol.dispose].bind(x)
				tryFn(disposeFn)
			}
			else {
				x[Symbol.asyncDispose]().then(() => onDone(), e => onDone(wrapIfNotError(e)))
			}
		}

		function tryFn(fn: () => unknown) {
			try {
				return fn()
			}
			catch (e) {
				return wrapIfNotError(e)
			}
		}

		function onDone(err?: Error) {
			++nDone
			if (err) {
				if (!onEndErrs) {
					onEndErrs = []
				}
				onEndErrs.push(err)
			}
			if (nDone === nWaiting) {
				me.#settle(onEndErrs)
			}
		}

		function _onJobDone(j: Job) {
			onDone(j._io instanceof Error ? j._io : undefined)
		}
	}

	#settle(onEndErrs?: Error[]) {
		if (this._state === "CANCELLING") {
			const msg = this._io as string   // hacky, I know

			this._io = onEndErrs ?
				new Err(undefined, this._name, onEndErrs, msg) as Ret :
				new ECancOK(this._name, msg) as Ret

			this.#completeSettle()
			return
		}

		if (onEndErrs) {
			if (this._io instanceof Err) {
				this._io.onEndErrors = onEndErrs
			}
		}

		this.#completeSettle()
	}

	#completeSettle() {
		// console.log("SETT:", this._name, this._io)
		this._state = "DONE"
		this._parent?._childs!.delete(this)
		this._parent = undefined
		this._emit(EV.JOB_DONE_WAITCHILDS, this)
		this._emit(EV.JOB_DONE, this)
	}

	// // todo
	// settle(val: Ret) {
	// 	// what if job is cancelling itself (or waiting for childs?)
	// 	// maybe a special Job class??
	// }

	onEnd(newV: OnEnd) {
		let currV = this._onEnds
		if (!currV) {
			this._onEnds = newV
		}
		else if (Array.isArray(currV)) {
			currV.push(newV)
		}
		else {
			this._onEnds = [currV, newV]
		}
	}

	get promfy() {
		return new Promise<Ret>((res, rej) => {
			this._on(EV.JOB_DONE, ({ val }: Job) => {
				if (val instanceof Error) {
					rej(val)
				}
				else {
					res(val as Ret)
				}
			})
		})
	}

	get promfyCont() {
		return new Promise<typeof this._io>(res => {
			this._on(EV.JOB_DONE, (j: Job) => {
				res(j.val as Ret)
			})
		})
	}

	// todo: remove in a commit.
	// then(thenOK: (value: Ret) => Ret, thenErr: (reason: unknown) => Promise<never>): Promise<Ret> {
	// 	return new Promise<Ret>((res, rej) => {
	// 		this._on(EV.JOB_DONE, ({ val }: Job) => {
	// 			if (val instanceof Error) {
	// 				rej(val)
	// 			}
	// 			else {
	// 				res(val as Ret)
	// 			}
	// 		})
	// 	}).then(thenOK, thenErr)
	// }
}


export function onEnd(x: OnEnd) {
	runningJob().onEnd(x)
}



/* **********  Block/Wait Job Iterables  ********** */

export let theIterResult = {
	done: false,
	value: 0 as unknown,
}

type RibuIterable<V> = {
	[Symbol.iterator]: () => Iterator<Yieldable, V>
}

function onJobDone(doneJob: Job, callerJob: Job) {
	if (callerJob._state === "BLOCKED_$" && doneJob.val instanceof Error) {
		// eslint-disable-next-line functional/immutable-data
		callerJob._io = new Err(doneJob.val, callerJob._name)
		callerJob._endProtocol()
	}
	else {
		callerJob._resume(doneJob.val)
	}
}

const waitJobIterable = {
	[Symbol.iterator]() {
		const { callerJob, targetJob } = sys

		if (targetJob._state !== "DONE") {
			targetJob._onDone(doneJob => onJobDone(doneJob, callerJob))
			return theIterator
		}

		if (callerJob._state === "BLOCKED_$" && targetJob.val instanceof Error) {
			// todo: throw??
			throw targetJob.val
		}

		callerJob._setResume(targetJob.val)
		return theIterator
	}
}



//* **********  Cancel logic  ********** */

function execCancel(): void {
	const { callerJob, targetJob } = sys
	const targetJState = targetJob._state

	if (targetJState === "DONE") {
		completeCancel(callerJob, targetJob)
	}

	targetJob._onDone(doneJob => completeCancel(callerJob, doneJob))

	if (targetJState === "WAITING_CHILDS") {
		targetJob._removeWaitChildsCBs()
	}
	if (targetJState === "CANCELLING") {
		return
	}
	targetJob._state === "CANCELLING"
	targetJob._io = `Cancelled by ${callerJob._name}`   // hacky, I know
	targetJob._endProtocol()
}

function completeCancel(callerJob: Job, targetJob: Job) {
	if (targetJob.val instanceof Error && !(targetJob instanceof ECancOK)) {
		// eslint-disable-next-line functional/immutable-data
		callerJob._io = new Err(targetJob.val, callerJob._name)
		callerJob._endProtocol()
	}
	else {
		callerJob._resume()
	}
}




//* **********  Utils  ********** */



function wrapIfNotError(x: unknown): Error {
	return x instanceof Error ? x : {
		name: "ThrownUnknownError",
		message: "Thrown value is not of type Error",
		cause: x
	}
}





function isProm(x: unknown): x is PromiseLike<unknown> {
	return (x !== null && typeof x === "object" &&
		"then" in x && typeof x.then === "function")
}



/** Ports
 // ports<_P extends Ports>(ports: _P) {
 // 	const prcApi_m = ports as WithCancel<_P>
 // 	// Since a new object is passed anyway, reuse the object for the api
 // 	prcApi_m.cancel = this.cancel.bind(this)
 // 	return prcApi_m
 // }
 *
 */

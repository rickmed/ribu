import { ArrSet, Events } from "./data-structures.ts"
import { ETimedOut, Err, isRibuE, ECancOK } from "./errors.ts"
import { runningJob, sys } from "./system.ts"


export function onEnd(x: OnEnd) {
	runningJob().onEnd(x)
}

export function me(): Job {
	return runningJob()
}

export function go<Args extends unknown[], Ret>(genFn: RibuGenFn<Ret, Args>, ...args: Args) {
	const gen = genFn(...args)
	return new Job<NotErrs<Ret>, OnlyErrs<Ret> | ECancOK | ETimedOut | Err>(gen, genFn.name, true)._run()
}


//* **********  Job Class  ********** *//

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

const EV = {
	JOB_DONE: "job.done",
	JOB_DONE_WAITCHILDS: "job.done.waitChilds"
} as const

// todo: maybe change to symbol
export const PARK_ = "P", CONTINUE_ = "CONT"
const	CANCEL = "CANC", CANCEL_JOBS = "CANC_JOBS"

export type PARK = typeof PARK_
export type CONTINUE = typeof CONTINUE_
type State = PARK | "RUNNING" | "BLOCKED_$" | "BLOCKED_cont" | "WAITING_CHILDS" | "CANCELLING" | "TIMED_OUT" | "DONE"

export class Job<Ret = unknown, Errs = unknown> extends Events {

	_io: Ret | Errs = "$dummy" as (Ret | Errs)
	_gen: Gen
	_name: string
	_state: State = PARK_

	// Because a job can settle with ECancOK which technically isn't a faillure but,
	// when awaiting for a job, the caller shouldn't continue if called job settled with ECancOK.
	_failed = false
	_childs?: ArrSet<Job>
	_parent?: Job
	_sleepTO?: NodeJS.Timeout
	_onEnds?: OnEnd | OnEnd[]
	_jobTimeout?: NodeJS.Timeout

	constructor(gen: Gen, genFnName: string, withParent?: boolean) {
		super()
		this._gen = gen
		this._name = genFnName
		if (withParent) {
			this.#addAsChild()
		}
	}

	_run() {
		this._resume()
		return this
	}

	#addAsChild() {
		let parent = runningJob()
		if (!parent) {
			return
		}
		let parentChilds = parent._childs
		if (!parentChilds) {
			parent._childs = parentChilds = new ArrSet()
		}
		parentChilds.add(this)
		this._parent = parent
	}

	_resume(IOval?: unknown): void {
		sys.stack.push(this)
		this._setResume(IOval)

		try {
			// eslint-disable-next-line no-var
			var yielded = this._gen.next(IOval)
		}
		catch (e) {
			this._io = new Err(e, this._name) as Ret
			this._endProtocol()
			return
		}

		sys.stack.pop()

		const {value} = yielded

		if (value === CANCEL) {
			execCancel()
			return
		}
		if (value === CANCEL_JOBS) {
			execCancelJobs()
			return
		}

		if (yielded.done) {
			this.#genFnReturned(value as Ret)
		}

		//else, job resumed uneventfully
	}

	_continue<IterReturn>(IOval?: unknown) {
		this._io = IOval as Ret
		return theIterable as TheIterable<IterReturn>
	}

	_park<IterReturn>(IOval?: unknown) {
		this._setPark(IOval)
		return theIterable as TheIterable<IterReturn>
	}

	_setResume(IOval?: unknown) {
		this._state = "RUNNING"
		this._io = IOval as Ret
	}

	_setPark(IOval?: unknown) {
		this._state = PARK_
		this._io = IOval as Ret
	}

	#genFnReturned(yieldedVal: Ret | Errs) {
		const settleVal = this._io = yieldedVal
		if (isRibuE(settleVal)) {
			if (settleVal._op === "") {
				// @ts-ignore (._op readonly)
				settleVal._op = this._name
			}
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
			const job = childs.arr[i]
			if (job) {
				job._on(EV.JOB_DONE_WAITCHILDS, cb)
			}
		}

		function cb(childDone: Job) {
			++nChildsDone
			if (childDone._failed) {
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
			const job = cs.arr[i]
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
		return blockJobIterable as TheIterable<Ret>
	}

	get cont() {
		this.#prepSystem("BLOCKED_cont")
		return blockJobIterable as TheIterable<typeof this._io>
	}

	#prepSystem(state: "BLOCKED_cont" | "BLOCKED_$"): void {
		runningJob()._state = state
		sys.targetJob = this
	}

	/**
	 * Fails caller if result is other than ECancOK
	 */
	cancel(): typeof CANCEL {
		sys.targetJob = this
		sys.cancelCallerJob = runningJob()
		return CANCEL
	}

	_endProtocol(errors?: Error[]) {
		const { _sleepTO, _jobTimeout, _onEnds, _childs } = this

		if (_sleepTO) {
			clearTimeout(_sleepTO)
		}

		if (_jobTimeout) {
			clearTimeout(_jobTimeout)
		}

		if (!(_onEnds || (_childs && _childs.size > 0))) {
			this.#_settle()
			return
		}

		const me = this
		let nWaiting = 0
		let nDone = 0

		if (_childs) {
			nWaiting += _childs.size
			const { arr } = _childs
			const len = arr.length
			for (let i = 0; i < len; i++) {
				const childJob = arr[i]
				if (childJob) {
					childJob._endProtocol()
					childJob._onDone(onJobDone)
				}
			}
		}

		if (_onEnds) {
			if (Array.isArray(_onEnds)) {
				const len = _onEnds.length
				for (let i = len - 1; i >= 0; i--) {  // last set, first called.
					execOnEnd(_onEnds[i]!)
				}
			}
			else {
				execOnEnd(_onEnds)
			}
		}

		function execOnEnd(x: OnEnd): void {
			++nWaiting
			if (isGenFn(x)) {
				new Job(x(), x.name)._run()._onDone(onJobDone)
			}
			else if (x instanceof Function) {
				const ret = tryFn(x)
				if (isProm(ret)) {
					ret.then(() => onDone(), e => onDone(wrapIfNotError(e)))
					return
				}
				if (ret instanceof Job) {
					ret._onDone(onJobDone)
					return
				}
				onDone(ret instanceof Error ? ret : undefined)
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
				return e
			}
		}

		function onDone(err?: Error) {
			++nDone
			if (err) {
				if (!errors) {
					errors = []
				}
				errors.push(err)
			}
			if (nDone === nWaiting) {
				me.#_settle(errors)
			}
		}

		function onJobDone(j: Job) {
			onDone(j._io instanceof Error ? j._io : undefined)
		}
	}

	#_settle(errors?: Error[]) {
		if (this._state === "CANCELLING" && errors) {
			const eCancOK = this._io as ECancOK
			this._io = new Err(undefined, this._name, errors, eCancOK.message) as Ret
			this.#completeSettle()
			return
		}
		if (errors) {
			if (this._io instanceof Err) {
				this._io.errors = errors
			}
		}
		this.#completeSettle()
	}

	#completeSettle() {
		const finalVal = this._io
		if (finalVal instanceof Error && !(finalVal instanceof ECancOK)) {
			this._failed = true
		}
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
		let { _onEnds } = this
		if (!_onEnds) {
			this._onEnds = newV
		}
		else if (Array.isArray(_onEnds)) {
			_onEnds.push(newV)
		}
		else {
			this._onEnds = [_onEnds, newV]
		}
	}

	get promfy() {
		return new Promise<Ret>((res, rej) => {
			this._onDone(jobDone => {
				if (jobDone._failed) {
					rej(jobDone.val as Error)
				}
				else {
					res(jobDone.val as Ret)
				}
			})
		})
	}

	get promfyCont() {
		return new Promise<typeof this._io>(res => {
			this._onDone(job => {
				res(job.val as Ret)
			})
		})
	}

	timeout(ms: number): this {

		this._jobTimeout = setTimeout(() => {
			// todo: fix bug "this" reference is lost in lambda
			if (this._state !== "DONE") {
				this._io = new ETimedOut(this._name) as Ret
				if (this._state === "WAITING_CHILDS") {
					this._removeWaitChildsCBs()
				}
				this._endProtocol()
			}
		}, ms)

		return this
	}

	get val() {
		return this._io
	}

	get failed(): boolean {
		return this._failed
	}

	settle(val: Ret | Errs) {
		if (this._state === "DONE") {
			return
		}
		this.#genFnReturned(val)
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

export function steal(toJob_m: Job, jobs: Job[]) {
	const len = jobs.length
	for (let i = 0; i < len; i++) {
		let job = jobs[i]!
		job._parent?._childs?.delete(job)
		job._parent = toJob_m
		if (!toJob_m._childs) {
			toJob_m._childs = new ArrSet()
		}
		toJob_m._childs.add(job)
	}
}



/* **********  Block/Wait Job Iterables  ********** */


const blockJobIterable = {
	[Symbol.iterator]() {
		const { targetJob } = sys
		const callerJob = runningJob()
		if (targetJob._state !== "DONE") {
			targetJob._onDone(doneJob => onJobDone(doneJob, callerJob))
			return theIterator
		}

		// else, targetJob is already settled...
		if (callerJob._state === "BLOCKED_$" && targetJob._failed) {
			callerJob._endProtocol()
		}
		callerJob._setResume(targetJob.val)
		return theIterator
	}
}

function onJobDone(doneJob: Job, callerJob: Job) {
	if (callerJob._state === "BLOCKED_$" && doneJob._failed) {
		// eslint-disable-next-line functional/immutable-data
		callerJob._io = new Err(doneJob.val, callerJob._name)
		callerJob._endProtocol()
	}
	else {
		callerJob._resume(doneJob.val)
	}
}



//* **********  Cancel logic  ********** *//

function execCancel(callCB = true): void {
	const { cancelCallerJob: callerJob, targetJob } = sys
	const targetJState = targetJob._state
	if (targetJState === "DONE") {
		onCancelJobIsDone(callerJob, targetJob)
		return
	}

	if (callCB) {
		targetJob._onDone(doneJob => onCancelJobIsDone(callerJob, doneJob))
	}

	if (targetJState === "WAITING_CHILDS") {
		targetJob._removeWaitChildsCBs()
	}
	if (targetJState === "CANCELLING") {
		return
	}
	targetJob._state = "CANCELLING"
	targetJob._io = new ECancOK(targetJob._name, `Cancelled by ${callerJob._name}`)
	targetJob._endProtocol()
}

function onCancelJobIsDone(callerJob: Job, targetJob: Job): void {
	if (targetJob._failed) {
		// eslint-disable-next-line functional/immutable-data
		callerJob._io = new Err(targetJob.val, callerJob._name)
		callerJob._endProtocol()
	}
	else {
		callerJob._resume()
	}
}

export function cancel(jobs: Job[]): typeof CANCEL_JOBS {
	sys.cancelCallerJob = runningJob()
	sys.cancelTargetJobs = jobs
	return CANCEL_JOBS
}

function execCancelJobs(): void {
	const { cancelCallerJob: callerJob, cancelTargetJobs: jobs } = sys

	const jobsLen = jobs.length
	let targetJobsErrors: Err[] | undefined
	let nJobsCancelling = jobsLen

	for (let i = 0; i < jobsLen; i++) {
		const job = jobs[i]!
		job._onDone(onCancelJobsDone)
		sys.targetJob = job
		execCancel(false)
	}

	function onCancelJobsDone(jobDone: Job) {
		nJobsCancelling--
		if (jobDone._failed) {
			if (!targetJobsErrors) {
				targetJobsErrors = []
			}
			targetJobsErrors.push(jobDone.val as Err)
		}
		if (nJobsCancelling === 0) {
			if (targetJobsErrors) {
				callerJob._io = new Err(undefined, callerJob._name)
				callerJob._endProtocol(targetJobsErrors)
			}
			else {
				callerJob._resume()
			}
		}
	}
}



//* **********  Utils  ********** *//

const GenFn = (function* () { }).constructor

function isGenFn(x: unknown): x is RibuGenFn {
	return x instanceof GenFn
}

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



//* **********  The Iterable  ********** *//

let theIterResult = {
	done: false,
	value: 0 as unknown,
}


export const theIterator = {
	next() {
		const job = runningJob()
		if (job._state === "RUNNING") {
			theIterResult.done = true
			theIterResult.value = job._io
		}
		else {
			theIterResult.done = false
		}
		return theIterResult
	}
}

export const theIterable = {
	[Symbol.iterator]() {
		return theIterator
	}
}


export type TheIterable<V> = {
	[Symbol.iterator]: () => Iterator<Yieldable, V>
}

export type TheIterator<V> = Iterator<unknown, V>



//* **********  Types  ********** *//

export type NotErrs<Ret> = Exclude<Ret, Error>
type OnlyErrs<Ret> = Extract<Ret, Error>

export type Yieldable =
	PARK | CONTINUE |
	typeof CANCEL |
	typeof CANCEL_JOBS |
	Promise<unknown>

export type Gen<Ret = unknown, Rec = unknown> =
	Generator<Yieldable, Ret, Rec>

export type RibuGenFn<Ret = unknown, Args extends unknown[] = unknown[]> =
	(...args: Args) => Generator<Yieldable, Ret>

type OnEnd =
	(() => unknown) | (() => Promise<unknown>) |
	Disposable | AsyncDisposable | RibuGenFn

/** Ports
 // ports<_P extends Ports>(ports: _P) {
 // 	const prcApi_m = ports as WithCancel<_P>
 // 	// Since a new object is passed anyway, reuse the object for the api
 // 	prcApi_m.cancel = this.cancel.bind(this)
 // 	return prcApi_m
 // }
 *
 */

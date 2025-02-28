import { sys } from "./system.ts"
import { Chan } from "./channel.ts"
import { ArrSet} from "./data-structures.ts"
import { ETimedOut, Err, isRibuE, ECancOK } from "./errors.ts"
import { Timeout } from "./timers.ts"
import { Observer } from "./shared.ts"


//* **********  System  ********** *//

export enum State {
	RUNNING = 1,
	PARKED_CONTINUE,
	PARKED_END_IF_ERR,
	PARKED_SLEEP,
	GEN_DONE_WAITING_CHILDS,
	GEN_DONE_WAITING_ASYNC_ONENDS,
	CANCELLING,
	DONE
}

export const { RUNNING, PARKED_CONTINUE, PARKED_END_IF_ERR, PARKED_SLEEP, GEN_DONE_WAITING_CHILDS, GEN_DONE_WAITING_ASYNC_ONENDS, CANCELLING, DONE } = State

type Targets = Target | Target[]

type StateCtx =
	| [State.RUNNING, 0]
	| [State.PARKED_CONTINUE, string]
	| [State.PARKED_END_IF_ERR, string]
	| [State.PARKED_SLEEP, Timeout]
	| [State.GEN_DONE_WAITING_CHILDS, Targets]
	| [State.GEN_DONE_WAITING_ASYNC_ONENDS, undefined]
	| [State.CANCELLING, null]
	| [State.DONE, {yes: boolean}]

type StateCtxVal<T extends State> = Extract<StateCtx, [T, unknown]> extends [T, infer U] ? U : never;

/* *** System variables *** */

let jobStack: Array<Job> = []
let jobInProcess!: Job



//* **********  Job Class  ********** *//

// cancelling children and onEnds
// nWaiting
// errors[], could use ._io



export class Job<Ret = unknown, Errs = unknown> implements Observer {

	_gen: Gen
	_name: string
	__state: State = RUNNING
	_stateCtx: StateCtxVal<State> = 0

	// Used as an Inbox/Outbox for the job
	val: Ret | Errs = "$dummy" as (Ret | Errs)

	// Because a job can settle with ECancOK, which technically isn't a failure but,
	// when const res = yield* job.$, the caller shouldn't continue if called job settled with ECancOK.
	_failed = false
	_childs?: ArrSet<Job>

	_onEnds?: OnEnd | OnEnd[]

	constructor(gen: Gen, genFnName: string, withParent?: boolean) {
		this._gen = gen
		this._name = genFnName
		if (withParent) {
			this.#addAsChild()
		}
	}

	_run() {
		resumeJob(this)
		return this
	}

	#addAsChild() {
		let parent = sys.runningJob
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

	onObservableDone(val: unknown) {

	}

	_resume(IOval?: unknown): void {
		sys.pushJob(this)
		this._setResume(IOval)

		try {
			// eslint-disable-next-line no-var
			var yielded = this._gen.next(IOval)
		}
		catch (e) {
			this.val = new Err(e, this._name) as Ret
			this._endProtocol()
			return
		}

		sys.popJob()

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
		this.val = IOval as Ret
		return theIterable as TheIterable<IterReturn>
	}

	_park<IterReturn>(IOval?: unknown) {
		this._setPark(IOval)
		return theIterable as TheIterable<IterReturn>
	}

	_setResume(IOval?: unknown) {
		this._state = "RUNNING"
		this.val = IOval as Ret
	}

	_setPark(IOval?: unknown) {
		this._state = PARK_
		this.val = IOval as Ret
	}

	#genFnReturned(yieldedVal: Ret | Errs) {
		const settleVal = this.val = yieldedVal
		if (isRibuE(settleVal)) {
			if (settleVal._op === "") {
				// @ts-ignore (._op readonly)
				settleVal._op = this._name
			}
			this._endProtocol()
			return
		}
		if (settleVal instanceof Error) {
			this.val = new Err(settleVal, this._name) as Ret
			this._endProtocol()
			return
		}
		if (this._childs?.size) {
			this.#waitChilds()
			return
		}
		this._endProtocol()
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
				me.val = new Err(childDone.val, me._name) as Ret
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

	get err() {
		this.#prepSystem("BLOCKED_cont")
		return blockJobIterable as TheIterable<typeof this.val>
	}

	get isReady() {
		return this.__state == DONE
	}

	#prepSystem(state: "BLOCKED_cont" | "BLOCKED_$"): void {
		sys.runningJob._state = state
		targetJob = this
	}

	/**
	 * Fails caller if result is other than ECancOK
	 */
	cancel(): typeof CANCEL {
		targetJob = this
		cancelCallerJob = sys.runningJob
		return CANCEL
	}

	_endProtocol(errors?: Error[]) {
		const { _sleepTO, _onEnds, _childs } = this

		if (_sleepTO) {
			clearTimeout(_sleepTO)
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
			onDone(j.val instanceof Error ? j.val : undefined)
		}
	}

	#_settle(errors?: Error[]) {
		if (this._state === "CANCELLING" && errors) {
			const eCancOK = this.val as ECancOK
			this.val = new Err(undefined, this._name, errors, eCancOK.message) as Ret
			this.#completeSettle()
			return
		}
		if (errors) {
			if (this.val instanceof Err) {
				this.val.errors = errors
			}
		}
		this.#completeSettle()
	}

	#completeSettle() {
		const finalVal = this.val
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



	get failed(): boolean {
		return this._failed
	}

	settle(val: Ret | Errs) {
		if (this._state === "DONE") {
			return
		}
		this.#genFnReturned(val)
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

	then(thenOK: (value: Ret) => Ret, thenErr: (reason: unknown) => Promise<never>): Promise<Ret> {
		return new Promise<Ret>((res, rej) => {
			this._on(EV.JOB_DONE, ({ val }: Job) => {
				if (val instanceof Error) {
					rej(val)
				}
				else {
					res(val as Ret)
				}
			})
		}).then(thenOK, thenErr)
	}


}

type Target = {
	removeObserver: (observer: Observer) => void
}


//* **********  State Machine Step function  ********** *//

export function Step(job: Job, ev: Event, evData: unknown): State {
	let state = job.__state
	let stateCtx = job._stateCtx
	let newState = state

	if (state === PARKED_SLEEP) {
		clearTimeout(stateCtx as StateCtxVal<typeof PARKED_SLEEP>)
	}

	// Maybe implement same protocol for all Step(JOB_FAILED)
	// so if I job is blocked at ch.rec and its cancelled
	// it will go to cancel state and channel will not resume

	// Maybe branch on event.
	// Maybe implement CANCEL setting a onEnd()

	// MAIN idea is that observers just adds itself in target.observers
	// so that targetJob can call a single function Step(callerJob, JOB_DONE, targetJob)
	// so it's observer responsability to branch on its state.

	// eslint-disable-next-line no-constant-condition
	while (1) {

		if (state === RUNNING) {
		// handle RUNNING

			newState = RUNNING
		}
		if (state === PARKED_CONTINUE) {
		// handle PARKED_CONTINUE
			newState = PARKED_CONTINUE
		}
		if (state === PARKED_END_IF_ERR) {
		// handle PARKED_END_IF_ERR
		// state = 'B';
			newState = PARKED_END_IF_ERR
		}

		if (state === GEN_DONE_WAITING_CHILDS) {
		// handle GEN_DONE_WAITING_CHILDS
			newState = GEN_DONE_WAITING_CHILDS
		}
		if (state === CANCELLING) {
		// handle CANCELLLING
			newState = CANCELLING
		}
		if (state === DONE) {
		// handle DONE
			newState = DONE
		}

		return newState
	}
}


export function resumeJob(job: Job) {
	jobStack.push(job)
	jobInProcess = job
	try {
		// No values are passed into gen.next() because values inside the generator
		// function are received automatically by the returned {value} of the
		// delegated theIterator
		const { done, value} = job._gen.next()
		if (done) {
			Step(job, JOB_RETURNED, value)
		}
	}
	catch (e) {
		Step(job, JOB_THREW, e)
	}
	finally {
		jobInProcess = jobStack.pop()!
	}
}

export function setRunning(job_m: Job) {
	job_m.__state = RUNNING
	job_m.val = undefined
}

export function setStateAndCtx<S extends State>(job_m: Job, state: S, stateCtx: StateCtxVal<S>) {
	job_m.__state = state
	job_m._stateCtx = stateCtx as StateCtxVal<State>
}

export function continueRunningJob(val?: unknown) {
	iterResult.done = true
	iterResult.value = val
}

export let iterResult = {
	done: false,
	value: 0 as unknown,
}

export type Iter<V> = Iterator<never, V, never>

export const iter = {
	next() {
		return iterResult
	}
}

export type NewTheIterable<V> = {
	[Symbol.iterator]: () => Iterator<never, V>
}

export const NewtheIterable = {
	[Symbol.iterator]() {
		return iter
	}
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
		const callerJob = sys.runningJob
		if (targetJob._state !== "DONE") {
			targetJob._onDone(doneJob => onJobDone(doneJob, callerJob))
			return iter
		}

		// else, targetJob is already settled...
		if (callerJob._state === "BLOCKED_$" && targetJob._failed) {
			callerJob._endProtocol()
		}
		callerJob._setResume(targetJob.val)
		return iter
	}
}

function onJobDone(doneJob: Job, callerJob: Job) {
	if (callerJob._state === "BLOCKED_$" && doneJob._failed) {
		// eslint-disable-next-line functional/immutable-data
		callerJob.val = new Err(doneJob.val, callerJob._name)
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
	targetJob.val = new ECancOK(targetJob._name, `Cancelled by ${callerJob._name}`)
	targetJob._endProtocol()
}

function onCancelJobIsDone(callerJob: Job, targetJob: Job): void {
	if (targetJob._failed) {
		// eslint-disable-next-line functional/immutable-data
		callerJob.val = new Err(targetJob.val, callerJob._name)
		callerJob._endProtocol()
	}
	else {
		callerJob._resume()
	}
}

export function cancel(jobs: Job[]): typeof CANCEL_JOBS {
	sys.cancelCallerJob = sys.runningJob
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
				callerJob.val = new Err(undefined, callerJob._name)
				callerJob._endProtocol(targetJobsErrors)
			}
			else {
				callerJob._resume()
			}
		}
	}
}

export function jobFailed(jobIO: unknown): jobIO is Err {
	return jobIO instanceof Err
}


export function onEnd(x: OnEnd) {
	sys.runningJob.onEnd(x)
}

export function me(): Job {
	return sys.runningJob
}

export function go<Args extends unknown[], Ret>(genFn: RibuGenFn<Ret, Args>, ...args: Args) {
	const gen = genFn(...args)
	return new Job<NotErrs<Ret>, OnlyErrs<Ret> | ECancOK | ETimedOut | Err>(gen, genFn.name, true)._run()
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



//* **********  The Iterable ********** *//


export type TheIterable<V> = {
	[Symbol.iterator]: () => Iterator<Yieldable, V>
}

export type TheIterator<V> = Iterator<unknown, V>



//* **********  Types  ********** *//

export type NotErrs<Ret> = Exclude<Ret, Error>
type OnlyErrs<Ret> = Extract<Ret, Error>

export type Gen<Ret = unknown, Rec = unknown> =
	Generator<never, Ret, Rec>

export type RibuGenFn<Ret = unknown, Args extends unknown[] = unknown[]> =
	(...args: Args) => Generator<never, Ret>

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

import { sys, type Link, Linkable, EMPTY, disposeLink, freshLink, LL, ObsLL, NtsLL, Observer } from "./shared.ts"
import { Chan } from "./channel.ts"
import { Timeout } from "./timers.ts"
import { ETimedOut, Err, isRibuE, ECancOK } from "./errors.ts"

/* EcancOK semantics
	- const res = yield* job    // caller fails
	- yield* job.cancel()    // caller resumes even though target's result is ECancOK (::Error)

*/
//* **********  System  ********** *//

export enum State {
	RUNNING = 1,
	PARKED,
	CANCELLING,
	WAITING_CHILDS,
	WAITING_ONENDS,
	DONE
}

export const { RUNNING, PARKED, WAITING_CHILDS, WAITING_ONENDS, CANCELLING, DONE } = State

const PARKED_END_IF_FAIL = 20
const PARKED_CONTINUE = 21
const PARKED_SLEEP = 22

type PARKED_CTX =
	typeof PARKED_END_IF_FAIL |
	typeof PARKED_CONTINUE |
	typeof PARKED_SLEEP

type MaybeErrsArr = Err[] | undefined

type StateCtx =
	| [State.RUNNING, undefined]
	| [State.PARKED, PARKED_CTX]
	| [State.WAITING_CHILDS, MaybeErrsArr]
	| [State.WAITING_ONENDS, MaybeErrsArr]
	| [State.DONE, undefined]

type StateCtxVal<T extends State> = Extract<StateCtx, [T, unknown]> extends [T, infer U] ? U : never;

/* *** System variables *** */

// change to LL using Node
let jobStack: Array<Job> = []
let jobInProcess!: Job
let self!: Job


//* **********  Job Class  ********** *//

export class Job<Ret = unknown, Errs = unknown> {

	_gen: Gen
	_name: string
	_state: State = RUNNING
	_stateCtx: StateCtxVal<State>
	_obH?: ObsLL<Observer>
	_ntH?: NtsLL<Job | Chan>
	val = EMPTY as Ret | Errs  //  inbox/outbox

	// Because a job can settle with ECancOK, which technically isn't a failure but,
	// when const res = yield* job.$, the caller shouldn't continue if called job settled with ECancOK.
	// not sure if needed
	_failed = false
	_childs?: Link<Job, unknown>

	// needed to be removed from parent's _childs LL when child is done
	_parent?: Link<Job, unknown>

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
		return theIterable as Iterable<IterReturn>
	}

	_park<IterReturn>(IOval?: unknown) {
		this._setPark(IOval)
		return theIterable as Iterable<IterReturn>
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


	_onDone(cb: (job: this) => void) {
		// this._on(EV.JOB_DONE, cb)
	}

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


	get err() {
		self = this
		return TheJobIterable as Iterable<typeof this.val>
	}

	[Symbol.iterator]() {
		const { runningJob } = sys
		const conn = Conn()
		linkJobs(ObJob, ntJob)
		this.#prepSystem("BLOCKED_$")
	}

	// todo: set this._gen = null, just in case
	settle(val: Ret | Errs) {
		if (this._state === "DONE") {
			return
		}
		this.#genFnReturned(val)
	}

	then(thenOK: (value: Ret) => Ret, thenErr: (reason: unknown) => Promise<never>): Promise<Ret> {
		// todo maybe simplify this
		return new Promise<Ret>((res, rej) => {

			const observerObj = {
				_onNtDone(val: unknown, notifierJobFailed?: boolean, valIsECancOK?: boolean) {
					void ((notifierJobFailed || valIsECancOK) ?
						rej(val as Error) :
						res(val as Ret))
				}
			}

			subscribeToNotifier(observerObj, this, freshLink(observer, notifier))

		}).then(thenOK, thenErr)
	}




	// need to know if I was cancelled originally i think
	_onNtDone(val: unknown, notifierJobFailed = false, resIsECancOK = false) {
		const { _state, _stateCtx } = this
		if (_state == PARKED) {
			if (_stateCtx == PARKED_CONTINUE) {
				// todo
				return
			}

			return
		}

		// problem is that notifier could have ended with ECancOK but need
		// to check here if i need to fail if I'm PARKED_END_IF_FAIL
		// (instanceof is expensive) and this is called by channels and so on
	}

	/**
	 * Fails caller if result is other than ECancOK
	 */
	cancel() {
		const { _state, _stateCtx } = this
		if (_state == DONE) {
			
		}
		this.val = CANCELLED as Ret  // reuse .val as a hack for context in .settle()

	}
}




/*********************  NEW FUNCTONS **************************** */

const CANCELLED = Symbol("canc")

export function resumeJob(thisJob: Job) {
	jobStack.push(thisJob)
	jobInProcess = thisJob
	try {
		// No values are passed into gen.next() because values inside the generator
		// function are received by the returned iteratorResult object
		const { done, value} = thisJob._gen.next()
		if (done) {
			thisJob.val = value
			endProtocol(thisJob)
		}
	}
	catch (e) {
		thisJob.val = new Err(e, thisJob._name)
		terminateJob(thisJob, sys.runningJob)
	}
	finally {
		jobInProcess = jobStack.pop()!
	}
}


/*
.cancel()
	unsub from notifiers (._ntH)
	if (childs), loop childs and call cancelJob(), move to state = waitingChilds
		this could just mutate Links in .chids LL to subscribe to childs' observers

jobReturned
	subscribe/wait for childs
	call/wait onEnds
jobThrew, jobCancelled
	waiting childs
		ctx can be same if (.childs), ie, childs in LL
	waiting (async) onEnds
		ctx can be same if (.onEnds), ie, childs in LL

Events:
	- cancel
		call all child.cancel() (child will subscribe caller)
		transition waitingChilds
	- jobThrew
		idem (but thrown error needs to be in .val)
	- jobReturned
	- ntJobFailed (need for ex to fail me if am PARKED_ERR)
*/

// endProtocol is wait_childs, then exec onEnds  (or settle() direcly)

function endProtocol(thisJob: Job) {
	if (thisJob._childs) {
		waitingChilds(thisJob)
	}
	else {
		// exec onEnds
	}
}

function cancelJob(thisJob: Job, callerJob: Job) {
	thisJob.val = CANCELLED
	removeFromNotifiers(thisJob)
	linkJobs(thisJob, callerJob)
	terminateJob(thisJob, callerJob)
}

function terminateJob(thisJob: Job, callerJob: Job) {
	// cancel all childs
	let childLink = thisJob._childs
	while (childLink) {
		const childJob = childLink.a
		cancelJob(childJob, thisJob)
		childLink = childLink.nA
	}
	thisJob._state = WAITING_CHILDS
	waitingChilds(thisJob)
}

function removeFromNotifiers(thisJob: Job) {
	let notifierLink = thisJob._ntH
	while (notifierLink) {
		// remove from notifier's observers LL
		notifierLink.nB.pB = notifierLink.pB
		notifierLink.pB.nB = notifierLink.nB

		notifierLink = notifierLink.nA
		disposeLink(notifierLink)
	}
}

// if I failed and observer is job... ?
function notifyObservers(thisJob: Job) {
	// loop over ._obH linked list like removeFromNotifiers
	let obsLink = thisJob._obH
	while (obsLink) {

		// remove as notifier from observer's LL
		obsLink.nA.pA = obsLink.pA
		obsLink.pA.nA = obsLink.nA

		obsLink = obsLink.nB

		// can check fast if I fail if _stateCtx is not undefined, has array errors,
		//  (need to reset _stateCtx after out of PARKED)
		// if .val == CANCELLED and _stateCtx is undefined (not have errors), then my result is ECancOK

		const obs = obsLink.a
		obs._onNtDone(self.val, thisJob._failed)
		disposeLink(obsLink)
	}
}


/* Job Possible Input Events */

// Exists because, otherwise, I'd to check in job._onNtDone(val) if val is
// instance of Error (slow) and ALSO, a system var to check if thing just done
// is a Job bc jobs don't fail if channels produce Error objects.
function onNtJobFailed(thisJob: Job, val: unknown) {
	// todo
}

function jobReturned(thisJob: Job, val: unknown) {
	// go to waiting childs
}

function jobThrew(thisJob: Job, val: unknown) {
}

/* Job State Handlers */

function waitingChilds(thisJob: Job) {
	if (thisJob._childs) {
		//
	}
}










export function setRunning(job_m: Job) {
	job_m._state = RUNNING
	job_m.val = undefined
}

export function setStateAndCtx<S extends State>(job_m: Job, state: S, stateCtx: StateCtxVal<S>) {
	job_m._state = state
	job_m._stateCtx = stateCtx as StateCtxVal<State>
}

export function continueRunningJob(val?: unknown) {
	iterRes.done = true
	iterRes.value = val
}

export let iterRes = {
	done: false,
	value: 0 as unknown,
}

export type Iter<V> = Iterator<never, V, never>

export const iterator = {
	next() {
		return iterRes
	}
}

export type NewTheIterable<V> = {
	[Symbol.iterator]: () => Iterator<never, V>
}

export const NewtheIterable = {
	[Symbol.iterator]() {
		return iterator
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


const TheJobIterable = {
	[Symbol.iterator]() {

		const callerJob = sys.runningJob

		if (self._state === DONE) {
			if (self._failed) {
				onNtJobFailed(callerJob, self.val)
				iterRes.done = false
			}
			else {
				iterRes.done = true
				iterRes.value = self.val
			}
		}
		else {
			linkJobs(callerJob, self)
			iterRes.done = false
		}

		return iterator
	}
}



function linkJobs(observer: Observer, notifier: Job) {

	let link = freshLink(observer, notifier)

	subscribeToNotifier(observer, notifier, link)

	// insert as head of observer's notifiers LL
	let notifiersOldHead = observer._ntH
	observer._ntH = link
	if (notifiersOldHead) {
		link.nA = notifiersOldHead
		notifiersOldHead.pA = link
	}

}

function subscribeToNotifier(observer: Observer, notifier: Job, link: Link<Observer, unknown>) {
	// insert as head of notifier's observers LL
	let observersOldHead = notifier._obH
	notifier._obH = link
	if (observersOldHead) {
		link.nB = observersOldHead
		observersOldHead.pB = link
	}
}


















function onJobDone(doneJob: Job, callerJob: Job) {
	if (callerJob._state === "BLOCKED_$" && doneJob._failed) {

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


export type Iterable<V> = {
	[Symbol.iterator]: () => Iterator<never, V>
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

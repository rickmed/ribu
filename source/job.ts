import { sys, type Link, VOID_OBJ, disposeLink, freshLink, Itrtor, iterRes, iterator, _Iterable, VoidObj, VOID_LINK, VoidLink, ensurePreviousYieldAndSetCallerJobNextSt } from "./system.js"
import { _Err, CANC_OK, CancOK, GenFnErr, OnEndErr, RibuErr, ChildErr } from "./errors.js"
import { Chan } from "./channel.js"

// todo: implement "unsub() to have something like trio's moveOnAfter()
// 	for jobs and job-helpers

// todo: implement using/dispose() for jobs
// 	check when a function is called and obj is in pool, throw (with flags)
// 	evaluate for channels as well


// todo: remove Job stack from sys, put it here and use LL
// todo: clean-up documentation





/* => DOING, make tests pass
Job's targets:
	Job, JobHelper (::Job), cancel (needs to be ::Job)
		calls notifyJob(ob: Job, tg: Job)
	Chan, Select
		calls resumeJob() directly.

Job's observers:
	Job, Promise
		just branch on type
*/



//* **********************  Job Class  ************************************* *//

export type RibuGen<Ret = unknown> =
	Generator<unknown, Ret, unknown>

type RibuGenFn<Ret = unknown, Args extends unknown[] = unknown[]> =
	(...args: Args) => RibuGen<Ret>

type JobsLink = Link<Job, Job>
type JobChanLink = Link<Job, Chan>
type WaitingChdLink = JobsLink
type TgOrChdLink = JobChanLink | WaitingChdLink

type OnJobDone = (val: unknown, tg: Job, ob: Job) => void
type ObserverJob = Job
type CallbackLink = Link<OnJobDone, ObserverJob>
type ObserverLink = JobsLink | CallbackLink

type SyncFn = () => unknown
type AsyncFn = () => Promise<unknown>
type OnEnd = SyncFn | AsyncFn | RibuGenFn
type OnEndLink = Link<OnEnd, VoidObj>

const DUMMY_GEN = (function* () {})()

// State Flags
const PARKED_CONTINUE = 1 << 0  // 1
const PARKED_JOB = 1 << 1  // 2
const PARKED_JOB_CANCEL = 1 << 2  // 4
export const PARKED_SLEEP = 1 << 3  // 8
const PARKED_CH = 1 << 4  // 16
const WAITING_CHILDREN = 1 << 5  // 32
const CHILDREN_CANCELLED = 1 << 6  // 64
const WAITING_ONENDS = 1 << 7  // 128
export const CANCELLED = 1 << 8  // 256
export const DONE = 1 << 9  // 512
const CANCOK = 1 << 10  // 1024
export const ERR_IN_GENFN = 1 << 11  // 2048
const ERR_IN_ONEND = 1 << 12  // 4096
const CANCEL_SIBLINGS_ON_ERR = 1 << 13  // 8192
// todo: implement this
// const JOB_IN_POOL = 1 << 14  // 16384

export const PARKED = PARKED_CONTINUE | PARKED_JOB | PARKED_JOB_CANCEL | PARKED_SLEEP | PARKED_CH
const HAD_ERR = ERR_IN_GENFN | ERR_IN_ONEND
export const ANY_ERR_OR_CANCOK = HAD_ERR | CANCOK

let self: Job

/** Job Class
 *  val:
 * 	Temporary slot for values; ch.put/rec, errors accumulation...
 * 	When job is settled, where its final value is stored.
 *  _nm:
 *		Name of the generator function, or the Job-like (set by Ribu).
 *  _st:
 * 	Job state (flags).
 *  _gn:
 * 	Generator object.
 *  _ob:
 * 	LL of observers observing this job.
 *  _tg:
 * 	A combined LL of the target the job is blocked by at yield* (tg) and its
 *  	children (chd), as "targets".
 * 	Since a job can only be blocked at yield* by one object at a time, we
 * 	store it as the head of the LL and store its respective PARKED_... flag.
 * 	The next links are to child jobs.
 *  _pr:
 * 	Link to parent job.
 *  _oe:
 * 	Singly LL of onEnds.
 *  _slp:
 * 	Timeout when yield* sleep().
 */
export class Job<OkRet = unknown, GetterErr = unknown> {

	val = null as OkRet | GetterErr
	_nm: string
	_st = 0
	_gn: RibuGen
	_ob: ObserverLink | VoidLink = VOID_LINK
	_tg: TgOrChdLink | VoidLink = VOID_LINK
	_pr: JobsLink | VoidLink = VOID_LINK
	_oe: OnEndLink | VoidLink = VOID_LINK
	_slp: NodeJS.Timeout | VoidObj = VOID_OBJ

	constructor(name: string, gen?: RibuGen, parent?: Job) {
		this._gn = gen ?? DUMMY_GEN
		this._nm = name
		if (parent) {
			const link = freshLink(parent, this)
			this._pr = link
			addTgOrChd(parent, link)
		}
	}
	/*
	ch.put  // caller.st |= PARKED_CH, ie, caller wants to put
	yield* job  // if caller is PARKED, throw
		// but it could have been set by .cancel() prepping

	I think I need different iterable objs.

	ch.put  // caller.st |= PARKED_CH, ie, caller wants to put
	yield* job.cancel()  // in cancel(), if caller is PARKED, throw

	cancelIterable.[Symbol.iterator]() {

	}
	*/

	[Symbol.iterator]() {
		ensurePreviousYieldAndSetCallerJobNextSt(PARKED_JOB, "yield* job")
		return jobIterator<OkRet>(this)
	}

	get err() {
		return this.jobIterable<GetterErr>(PARKED_CONTINUE, "job.err")
	}

	cancel() {
		cancelJob(this)
		return this.jobIterable<CancOK>(PARKED_JOB_CANCEL, "job.cancel")
	}

	cancelErr() {
		cancelJob(this)
		return this.jobIterable<CancOK | OnEndErr | ChildErr>(PARKED_CONTINUE, "job.cancelErr")
	}

	jobIterable<YieldRet>(callerJobNextSt: Job["_st"], opName: string) {
		self = this
		ensurePreviousYieldAndSetCallerJobNextSt(callerJobNextSt, opName)
		return JOB_ITERABLE as _Iterable<YieldRet>
	}

	onEnd(onEndFn: OnEnd) {
		onEnd(onEndFn, this)
	}

	cancelSiblingsOnErr() {
		this._st |= CANCEL_SIBLINGS_ON_ERR
	}

	isDone() {
		return this._st & DONE
	}

	get promErr() {
		const self = this
		return new Promise<GetterErr>((res) => {
			const link = freshLink(res as OnJobDone, self)
			addObserver(self, link)
		})
	}

	then(res: (val: OkRet) => void, rej: (err: GetterErr) => void) {
		if (this._st & DONE) {
			resolveJobThenable(res, rej, this)
		}
		else {
			const link = freshLink(onJobDone, this)
			addObserver(this, link)
		}

		function onJobDone(_: unknown, thisJob: Job) {
			resolveJobThenable(res, rej, thisJob)
		}
	}
}

function resolveJobThenable<OkRet, GetterErr>(res: (val: OkRet) => void, rej: (err: GetterErr) => void, thisJob: Job) {
	const { _st, val } = thisJob
	if (_st & ANY_ERR_OR_CANCOK) {
		rej(val as GetterErr)
	}
	else {
		res(val as OkRet)
	}
}

function jobIterator<T>(job: Job) {
	let callerJob = sys.runningJob

	if (job._st & DONE) {
		if (shouldJobFail(callerJob, job)) {
			genFnFailed(callerJob, job.val)
			iterRes.done = false
		}
		else {
			callerJob._st &= ~PARKED
			iterRes.done = true
			iterRes.value = job.val
		}
	}
	else {
		linkJobs(callerJob, job)
		iterRes.done = false
	}

	return iterator as Itrtor<T>
}

const JOB_ITERABLE = {
	[Symbol.iterator]() {
		return jobIterator(self)
	}
}

export function resumeJob(job: Job, val?: unknown) {
	job._st &= ~PARKED
	sys.pushJob(job)

	// Values are never passed into gen.next() because values inside the generator
	// function are received mutating iteratorResult object of the
	// delegated iterator.

	// The function/object which yield* is called upon will mutate the
	// iteratorResult object to .done = false to park the job.
	// Later, resumeJob() will be called by the target object.
	// The iteratorResult object will be mutated to .done = true and .value =
	// the desired value to resume the job to, gen.next() is called and the
	// js runtime will call the same delegated iterator, which will return the
	// same iteratorResult object, but now mutated to resume the job.

	iterRes.done = true
	iterRes.value = val
	try {
		const { done, value} = job._gn.next()
		if (!done) {
			return
		}
		if (value instanceof Error) {
			genFnFailed(job, value)
		}
		else {
			job.val = value
			onGenFnEnded(job)
		}
	}
	catch (e) {
		genFnFailed(job, e)
	}
	finally {
		sys.popJob()
	}
}

function onGenFnEnded(job: Job, cancelChildren = false) {
	if (job._tg === VOID_LINK) {
		execOnEnds(job)
		return
	}

	job._st |= WAITING_CHILDREN
	loopChildren(job, true, cancelChildren)
}

function genFnFailed(job: Job, cause: unknown) {
	job._st |= ERR_IN_GENFN
	job._st |= CANCEL_SIBLINGS_ON_ERR
	job.val = GenFnErr(job._nm, cause)
	onGenFnEnded(job, true)
}


const syncFnCtor = (function DUMMY_SYNC_FN() {}).constructor
const genFnCtor = (function* DUMMY_GEN_FN() {}).constructor

function execOnEnds(job: Job) {
	const onEndLink = job._oe
	if (onEndLink === VOID_LINK) {
		job._st &= ~WAITING_ONENDS
		settle(job)
		return
	}

	job._st |= WAITING_ONENDS

	const onEnd = onEndLink.a as OnEnd
	job._oe = onEndLink.nA as OnEndLink
	disposeLink(onEndLink)

	if (onEnd.constructor === syncFnCtor) {
		try {
			// eslint-disable-next-line no-var
			var retVal = onEnd()
		}
		catch (e) {
			retVal = e
		}
		if (retVal instanceof Error) {
			addOnErrInOnEnd(job, retVal)
		}
		execOnEnds(job)
		return
	}

	if (onEnd.constructor === genFnCtor) {
		const job = new Job(onEnd.name, (onEnd as RibuGenFn)())
		const observingLink = freshLink(onOnEndJobDone, job)
		addObserver(job, observingLink)
		resumeJob(job)
		return
	}

	(onEnd as AsyncFn)().then(
		() => {
			execOnEnds(job)
		},
		(err) => {
			addOnErrInOnEnd(job, err)
			execOnEnds(job)
		}
	)
}

function addOnErrInOnEnd(job: Job, val: unknown) {
	addErrorToJobVal(job, OnEndErr(val, job._nm), ERR_IN_ONEND, "onEnd")
}

function onOnEndJobDone(val: unknown, tg: Job, ob: Job) {
	if (tg._st & ERR_IN_GENFN) {
		addOnErrInOnEnd(ob, val)
	}
	execOnEnds(ob)
}

function settle(job: Job) {
	// Release parent-child link.
	const { _pr } = job
	if (_pr !== VOID_LINK) {
		const link = _pr as JobsLink
		removeTgOrChd(link.a, link)
		job._pr = VOID_LINK
		disposeLink(link)
	}

	finishSettle(job)
}

export function finishSettle(job: Job) {
	const { _st } = job

	if (_st & CANCELLED && !(_st & ERR_IN_ONEND)) {
		job.val = CANC_OK
		job._st = CANCOK
	}

	job._st |= DONE

	const { val } = job

	// notify observers
	let link = job._ob
	while (link !== VOID_LINK) {
		const nextLink = link.nA
		const observer = link.a
		if (typeof observer === "function") {
			observer(val, job, link.b as Job)
		}
		else {  // JobsLink
			removeOb(job, link as JobsLink)
			removeTgOrChd(observer as Job, link as JobsLink)
			disposeLink(link)
			onTgJobDone(observer as Job, job)
		}
		link = nextLink
	}
}

function onTgJobDone(job: Job, tgJob: Job) {
	if (job._st & WAITING_CHILDREN) {
		onChildDone(job, tgJob)
	}
	// Parked at yield* tgJob.
	if (shouldJobFail(job, tgJob)) {
		genFnFailed(job, tgJob.val)
		return
	}
	resumeJob(job, tgJob.val)
}

function onChildDone(job: Job, child: Job) {
	let { _tg, _st } = job

	if (!(child._st & HAD_ERR)) {
		return
	}

	addErrorToJobVal(job, child.val as RibuErr, ERR_IN_GENFN, "child")

	if (_tg === VOID_LINK) {
		execOnEnds(job)
		return
	}

	if ((_st & CANCEL_SIBLINGS_ON_ERR) && !(_st & CHILDREN_CANCELLED)) {
		loopChildren(job, false, true)
	}
}

// Is cancelJob() caller responsibility to not subscribe if job is done,
// otherwise, observer job will be blocked forever.
const CANCEL_NOOP = DONE | CANCELLED | WAITING_ONENDS
export function cancelJob(job: Job) {
	const { _st } = job
	if (_st & CANCEL_NOOP) {
		return
	}

	if (_st & PARKED_SLEEP) {
		clearTimeout(job._slp as NodeJS.Timeout)
		job._slp = VOID_OBJ
	}
	else if (_st & PARKED_CH) {
		// todo: unsub from channel
	}
	else { // parked by a ::Job
		const link = job._tg as JobsLink
		removeTgOrChd(job, link)
		removeOb(link.b, link)
		disposeLink(link)
	}

	if (job._tg === VOID_LINK) {
		execOnEnds(job)
		return
	}

	// Children already cancelled and job is linked/waiting for them.
	if (_st & CHILDREN_CANCELLED) {
		return
	}

	// Waiting for children but not cancelled yet, so trigger cancel
	// but don't link them again.
	if (job._st & WAITING_CHILDREN) {
		loopChildren(job, false, true)
		return
	}

	// Trigger cancel and link to them.
	loopChildren(job, true, true)
}

function loopChildren(job: Job, observe: boolean, cancel: boolean) {
	if (cancel) {
		job._st |= CHILDREN_CANCELLED
	}

	let childLink = job._tg
	// Can start loop right away bc caller guards against job state.
	do {
		const childJob = childLink.b
		if (observe) {
			addObserver(job, childLink as JobsLink)
		}
		// Need to save nextLink here because child can resolve its cancellation
		// synchronously and remove link from .tg_ch LL.
		const nextLink = childLink.nB
		if (cancel) {
			cancelJob(childJob as Job)
		}
		childLink = nextLink
	} while (childLink !== VOID_LINK)
}

function shouldJobFail(ObJob: Job, tgJob: Job) {
	return (ObJob._st & PARKED_JOB) && (tgJob._st & ANY_ERR_OR_CANCOK) ||
		(ObJob._st & PARKED_JOB_CANCEL) && (tgJob._st & ERR_IN_ONEND)
}

type ErrType = "child" | "onEnd"
export function addErrorToJobVal(job: Job, cause: RibuErr, st: Job["_st"], errType: ErrType) {
	const { _st } = job
	if (!(_st & HAD_ERR)) {
		const errMsg = _st & CANCELLED ? "cancelled" : ""

		const err = errType === "child" ?
			ChildErr(job._nm, cause, errMsg) :
			OnEndErr(cause, job._nm, errMsg)

		job.val = err
	}
	else {
		(job.val as RibuErr).addErr(cause)
	}

	job._st |= st
}


//* ***********************  Job LLs Operations  ******************** *//

/* Insert Link B:

	obj.LLHead
				\
		VL <-> A <-> VL

	obj.LLHead
				\
		VL <-> B <-> A <-> VL
*/

function addObserver(job: Job, link: ObserverLink) {
	let head = job._ob
	job._ob = link
	link.nA = head
	head.pA = link
}

function removeOb(job: Job, link: ObserverLink) {
	let { pA, nA } = link
	pA.nA = nA
	nA.pA = pA
	if (nA === VOID_LINK) {
		job._ob = VOID_LINK
	}
}

// We can safely add blocking target (Tg) and child jobs (Chd) as head
// always because:
// Tg behaves like a stack Link, ie, it is added as head when job is blocked
// and removed when job is resumed, ie, go(), which adds childs, can never
// be called in between block/unblock.
function addTgOrChd(job: Job, link: TgOrChdLink) {
	let oldHead = job._tg
	job._tg = link
	link.nB = oldHead
	oldHead.pB = link
}

function removeTgOrChd(job: Job, link: TgOrChdLink) {
	let { pB, nB } = link
	pB.nB = nB
	nB.pB = pB
	if (nB === VOID_LINK) {
		job._tg = VOID_LINK
	}
	// No need to set link.nA/pA to void since caller should
	// dispose the link immediately.
}

export function linkJobs(ob: Job, tg: Job) {
	const link = freshLink(ob, tg)
	addTgOrChd(ob, link)
	addObserver(tg, link)
}



//* ****************   User API   ****************************************** *//

type AllErrs = GenFnErr | OnEndErr | ChildErr

export function go<Args extends unknown[], Ret>(genFn: RibuGenFn<Ret, Args>, ...args: Args) {
	const gen = genFn(...args)
	const job = new Job<Exclude<Ret, Error>, Ret | AllErrs | CancOK>(genFn.name, gen, sys.runningJob)
	resumeJob(job)
	return job
}

export function me(): Job {
	return sys.runningJob
}

export function onEnd(onEnd: OnEnd, job = sys.runningJob) {
	let link = freshLink(onEnd, VOID_OBJ)
	let head = job._oe
	job._oe = link
	link.nA = head
}



//* **********************  cancel(...jobs) ******************************** *//

/*
- SelectJob works super cool

allOrErr
allSettled
first
firstOK

FAIL/CANCELLING INNER:
	- Helpers never cancel jobs when finishing. But they implement:
		- cancel() (cancels passed in jobs)
		- unsub() (unsubs from passed in jobs so caller can move on)
	- at const res = yield* helper(jobs...), and helper fails, it fails caller
		(but it only unsub from jobs).
		- If jobs are caller's children, they'll be cancelled via parent's
			structured concurrency.


=> IMPLEMENTATION. Need:


get err()
allOrErr
	i think works as is.
allSettled
first
firstOK


cancel(...jobs):
	- No way to cancel what cancel(...jobs) returns.
		- can only .unsub() from it.
	- cancell inner jobs

	- get err()
	- .cancelErr()

*/



// export function cancel(...jobs: Job[]) {
// 	let callerJob = sys.runningJob
// 	callerJob._st |= PARKED_JOB_CANCEL
// 	const observer = new CancelAll()
// 	subscribeToAllJobs(jobs, observer, true)
// }

// class CancelAll extends Job {

// 	_nm = "cancel"
// 	val: GetterErr = VOID_OBJ as GetterErr


// 	_onTgDone(tgVal: unknown, tg: Job) {
// 		const { val, _tg } = this
// 		if (tg._st & ERR_IN_ONEND) {
// 			// addErrorToJobVal(this, tgVal as Err)
// 		}
// 		if (!_tg) {
// 			this._st |= DONE
// 			notifyObservers(this, val)
// 		}
// 	}
// }

// export function subscribeToAllJobs(jobs: Job[], ob: Ob, cancel = false) {
// 	for (let i = 0; i < jobs.length; i++) {
// 		const job = jobs[i]!
// 		if (job._st & DONE) {
// 			ob._onTgDone(job.val, job)
// 			return
// 		}
// 		linkJobs(ob, job)
// 		if (cancel) {
// 			cancelJob(job)
// 		}
// 	}
// }

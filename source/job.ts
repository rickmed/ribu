import { sys, type Link, VOID_OBJ, disposeLink, freshLink, Itrtor, iterRes, iterator, _Iterable, VoidObj, VOID_LINK, VoidLink, ensurePreviousYieldAndSetCallerJobNextSt } from "./system.js"
import { Er, Err, _Err } from "./errors.js"
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
type OnEndLink = Link<OnEnd, Job>

const DUMMY_GEN = (function* () {})()

export type CancOK = Err<"CancOK">
function CancOK(fnName: string): CancOK {
	return new Err("CancOK", fnName)
}

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
const TIME_LIMIT_FIRED = 1 << 14  // 16384
// todo: implement this when [Symbol.dispose] is implemented
// const JOB_IN_POOL = 1 << 15  // 32768

export const PARKED = PARKED_CONTINUE | PARKED_JOB | PARKED_JOB_CANCEL | PARKED_SLEEP | PARKED_CH
const HAD_ERR = ERR_IN_GENFN | ERR_IN_ONEND
export const ANY_ERR_OR_CANCOK = HAD_ERR | CANCOK

let self: Job
let currentOp = ""

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
 *  _tm:
 * 	Timeout when yield* sleep() or some other inner timeout.
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
	_tm: NodeJS.Timeout | VoidObj = VOID_OBJ

	constructor(name: string, gen?: RibuGen, parent?: Job) {
		this._gn = gen ?? DUMMY_GEN
		this._nm = name
		if (parent) {
			const link = freshLink(parent, this)
			this._pr = link
			addTgOrChd(parent, link)
		}
	}

	_onTgJobDone(tgJob: Job) {
		if (this._st & WAITING_CHILDREN) {
			onChildDone(this, tgJob)
			return
		}
		// Parked at yield* tgJob or yield* tgJob.err/cancel/cancelErr.
		if (shouldJobFail(this, tgJob)) {
			genFnFailed(this, _Err(this._nm, tgJob.val as Err))
			return
		}
		resumeJob(this, tgJob.val)
	}

	[Symbol.iterator]() {
		ensurePreviousYieldAndSetCallerJobNextSt(PARKED_JOB, currentOp || "yield*")
		currentOp = ""
		return jobIterator<OkRet>(this)
	}

	get err() {
		return this._jobIterable<GetterErr>(PARKED_CONTINUE, ".err")
	}

	cancel() {
		cancelJob(this)
		return this._jobIterable<CancOK>(PARKED_JOB_CANCEL, ".cancel")
	}

	cancelErr() {
		cancelJob(this)
		return this._jobIterable<CancOK | Er>(PARKED_CONTINUE, ".cancelErr")
	}

	// todo: move to standalone function
	_jobIterable<YieldRet>(callerJobNextSt: Job["_st"], opName: string) {
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

	// todo
	unobserve() {
		// const { runningJob } = sys
		// const { _ob } = this
		// if (_ob === VOID_LINK) {
		// 	return
		// }
		// removeOb(this, _ob)
		// this._ob = VOID_LINK
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
			genFnFailed(callerJob, _Err(callerJob._nm, job.val as Err))
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

	// Values are never passed into gen.next() because values inside the
	// generator function are received mutating iteratorResult object
	// of the delegated iterator.

	// The function/object which yield* is called upon will mutate the
	// iteratorResult object to .done = false to park the job.
	// Later, resumeJob() will be called by the target object.
	// The iteratorResult object will be mutated to .done = true and .value =
	// the desired value to resume the job to, gen.next() is called and the
	// js runtime will call the same delegated iterator, which will return the
	// same iteratorResult object, but now mutated to resume the job.

	iterRes.done = true
	iterRes.value = val  // This is the value passed-in to the generator function.

	let genFnThrew = false
	try {
		// eslint-disable-next-line no-var
		var { done, value } = job._gn.next()
	}
	catch (e) {
		genFnThrew = true
		value = e
	}

	sys.popJob()

	if (done === false) {
		return
	}

	if (value instanceof Err) {
		// @ts-ignore mutation of .fn readonly property
		value.fn = job._nm
		genFnFailed(job, value as Err)
		return
	}

	if (genFnThrew) {
		genFnFailed(job, _Err(job._nm, value))
		return
	}

	job.val = value
	onGenFnDone(job)
}

function onGenFnDone(job: Job, cancelChildren = false) {
	if (job._tg === VOID_LINK) {
		execOnEnds(job)
		return
	}

	job._st |= WAITING_CHILDREN
	loopChildren(job, true, cancelChildren)
}

function genFnFailed(job: Job, jobVal: Err) {
	job.val = jobVal
	job._st |= ERR_IN_GENFN
	job._st |= CANCEL_SIBLINGS_ON_ERR
	onGenFnDone(job, true)
}

const syncFnCtor = (function DUMMY_SYNC_FN() {}).constructor
const genFnCtor = (function* DUMMY_GEN_FN() {}).constructor

function execOnEnds(job: Job) {
	const onEndLink = job._oe
	if (onEndLink === VOID_LINK) {
		job._st &= ~WAITING_ONENDS
		settleJob(job)
		return
	}

	job._st |= WAITING_ONENDS

	const onEnd = onEndLink.a as OnEnd
	job._oe = onEndLink.nA as OnEndLink
	disposeLink(onEndLink)

	const onEndCtor = onEnd.constructor

	if (onEndCtor === syncFnCtor) {
		let threw = false
		try {
			// eslint-disable-next-line no-var
			var retVal = onEnd()
		}
		catch (e) {
			retVal = e
			threw = true
		}
		handleOneOnEndResult(job, retVal, onEnd, threw)
		return
	}

	if (onEndCtor === genFnCtor) {
		const onEndJob = new Job(onEnd.name, (onEnd as RibuGenFn)())
		const observingLink = freshLink(onOnEndJobDone, job)
		addObserver(onEndJob, observingLink)
		resumeJob(onEndJob)
		return
	}

	(onEnd as AsyncFn)()
		.then(val => handleOneOnEndResult(job, val, onEnd))
		.catch(e =>
			handleOneOnEndResult(job, e, onEnd, true))
}

function handleOneOnEndResult(job: Job, onEndResult: unknown, onEnd: OnEnd, threw = false) {
	if (onEndResult instanceof Err) {
		// @ts-ignore mutation of .fn readonly property
		onEndResult.fn = onEnd.name
		addOnEndErr(job, onEndResult as Err)
	}
	else if (onEndResult instanceof Error) {
		addOnEndErr(job, onEndResult)
	}
	else if (threw) {  // threw something weird.
		addOnEndErr(job, _Err(onEnd.name, onEndResult))
	}
	execOnEnds(job)
}

function onOnEndJobDone(val: unknown, tg: Job, ob: Job) {
	if (tg._st & HAD_ERR) {
		addOnEndErr(ob, val as Err)
	}
	execOnEnds(ob)
}

const CANCELLED_STR = "Cancelled"

function addOnEndErr(job: Job, err: Error) {
	addErrorToJobVal(job, err, ERR_IN_ONEND)
	if (job._st & CANCELLED) {
		// @ts-ignore job.val is Err now and mutation of .message readonly property
		job.val.message = CANCELLED_STR
	}
}

function settleJob(job: Job) {
	// Release parent-child link.
	const { _pr, _st } = job
	if (_pr !== VOID_LINK) {
		removeTgOrChd(_pr.a as Job, _pr as JobsLink)
		job._pr = VOID_LINK
		disposeLink(_pr)
	}

	if (_st & CANCELLED && !(_st & ERR_IN_ONEND)) {
		job.val = CancOK(job._nm)
		job._st = CANCOK
	}

	settleJobish(job)
}

function settleJobish(job: Job) {
	job._st |= DONE
	const { val } = job

	let obLink = job._ob
	while (obLink !== VOID_LINK) {
		const nextLink = obLink.nA
		const observer = obLink.a
		if (typeof observer === "function") {
			observer(val, job, obLink.b as Job)
		}
		else {  // JobsLink
			removeOb(job, obLink as JobsLink)
			removeTgOrChd(observer as Job, obLink as JobsLink)
			disposeLink(obLink)
			;(observer as Job)._onTgJobDone(job)
		}
		obLink = nextLink
	}
}

function onChildDone(job: Job, child: Job) {
	if (child._st & HAD_ERR) {
		addErrorToJobVal(job, child.val as Err, ERR_IN_GENFN)
		const { _st } = job
		if ((_st & CANCEL_SIBLINGS_ON_ERR) && !(_st & CHILDREN_CANCELLED)) {
			loopChildren(job, false, true)
		}
	}

	if (job._tg === VOID_LINK) {
		execOnEnds(job)
		return
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

	job._st |= CANCELLED

	if (_st & PARKED_SLEEP) {
		clearTimeout(job._tm as NodeJS.Timeout)
		job._st &= ~PARKED_SLEEP
		job._tm = VOID_OBJ
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
		let childJob = childLink.b as Job
		if (observe) {
			// Parent-child are already connected via ._tg/._pr, so we need to
			// move child._pr link and add it to child._ob, so child doesn't
			// process its relationship in settle() with parent twice (once via
			// .pr and once via ._ob).
			addObserver(childJob, childJob._pr as JobsLink)
			childJob._pr = VOID_LINK
		}
		// Need to save nextLink here because child can resolve its cancellation
		// synchronously and remove link from .tg_ch LL.
		const nextLink = childLink.nB
		if (cancel) {
			cancelJob(childJob)
		}
		childLink = nextLink
	} while (childLink !== VOID_LINK)
}

function shouldJobFail(ObJob: Job, tgJob: Job) {
	return (ObJob._st & PARKED_JOB) && (tgJob._st & ANY_ERR_OR_CANCOK) ||
		(ObJob._st & PARKED_JOB_CANCEL) && (tgJob._st & ERR_IN_ONEND)
}

export function addErrorToJobVal(job: Job, err: Error, errFlag: Job["_st"]) {
	if (!(job._st & HAD_ERR)) {
		job.val = _Err(job._nm)
	}
	const errVal = job.val as Err
	if (errFlag & ERR_IN_GENFN) {
		errVal._addErr(err)
	}
	else {
		errVal._addOnEndErr(err)
	}
	job._st |= errFlag
}


//* ***********************  Job LLs Operations  ******************** *//

/* Insert Link B:

	obj.LLHead
				\
		VL <- A -> VL

	obj.LLHead
				\
		VL <- B <-> A -> VL
*/

function addObserver(job: Job, link: ObserverLink) {
	let head = job._ob
	link.nA = head
	job._ob = link
	if (head !== VOID_LINK) {
		head.pA = link
	}
}

function removeOb(job: Job, link: ObserverLink) {
	let { pA, nA } = link
	if (nA !== VOID_LINK) {
		nA.pA = pA
	}
	if (pA !== VOID_LINK) {
		pA.nA = nA
	}
	if (nA === VOID_LINK) {  // link is head
		job._ob = VOID_LINK
	}
}

// We can safely add blocking target (Tg) and child jobs (Chd) as head
// always because:
// Tg behaves like a stack Link, ie, it is added as head when job is blocked
// and removed when job is resumed, ie, go(), which adds childs, can never
// be called in between block/unblock.
function addTgOrChd(job: Job, link: TgOrChdLink) {
	let head = job._tg
	link.nB = head
	job._tg = link
	if (head !== VOID_LINK) {
		head.pB = link
	}
}

function removeTgOrChd(job: Job, link: TgOrChdLink) {
	let { pB, nB } = link
	if (nB !== VOID_LINK) {
		nB.pB = pB
	}
	if (pB !== VOID_LINK) {
		pB.nB = nB
	}
	if (pB === VOID_LINK) {  // link is head
		job._tg = nB
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

export function go<Args extends unknown[], Ret>(genFn: RibuGenFn<Ret, Args>, ...args: Args) {
	const gen = genFn(...args)
	const job = new Job<Exclude<Ret, Error>, Ret | Er | CancOK>(genFn.name, gen, sys.runningJob)
	resumeJob(job)
	return job
}

export function me(): Job {
	return sys.runningJob
}

export function onEnd(onEnd: OnEnd, job = sys.runningJob) {
	let link = freshLink(onEnd, job)
	let head = job._oe
	job._oe = link
	if (head !== VOID_LINK) {
		link.nA = head
	}
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
	- At const res = yield* helper(jobs...), and helper fails, it fails caller
		(but it only unsub from jobs).
		- If jobs are caller's children, they'll be cancelled via parent's
			structured concurrency anyway.


=> IMPLEMENTATION. Need:


get err()
allOrErr
	i think works as is.
allSettled
first
firstOK

*/

const CANCEL_ALL_OP_NAME = "cancel(...jobs)"
export const CANCEL_ALL_TIMEOUT = new Err("CancelTimeout", CANCEL_ALL_OP_NAME)
export type CancelAllTimeout = typeof CANCEL_ALL_TIMEOUT

export function cancel(...jobs: Job[]) {
	const cancelJobs = new CancelJobs()
	linkWithAllJobs(jobs, cancelJobs, true)
	currentOp = CANCEL_ALL_OP_NAME
	return cancelJobs as Pick<CancelJobs, "err" | typeof Symbol.iterator | "maxWait">
}

class CancelJobs extends Job<void, void | Er> {

	constructor() {
		super(CANCEL_ALL_OP_NAME)
		this.val = undefined
	}

	_onTgJobDone(tgJob: Job) {
		const { _st, _tg } = this
		if (_st & TIME_LIMIT_FIRED) {  // timeout fired
			this._tm = VOID_OBJ
			// reset ._st and .val in case some jobs already settled with Err.
			this._st = 0
			// settle with some sigil
			this.val = CANCEL_ALL_TIMEOUT as unknown as Er
			// Make caller fail if it didn't call .err to handle the unhappy paths.
			this._st |= ERR_IN_GENFN
			unlinkFromAllJobs(this)
			settleJobish(this)
			return
		}
		if (tgJob._st & HAD_ERR) {
			addErrorToJobVal(this, tgJob.val as Err, ERR_IN_GENFN)
		}
		if (_tg === VOID_LINK) {
			if (this._tm !== VOID_OBJ) {
				clearTimeout(this._tm as NodeJS.Timeout)
				this._tm = VOID_OBJ
			}
			settleJobish(this)
		}
	}

	maxWait(ms: number) {
		this._tm = setTimeout(maxWaitFired, ms, this)
		return this as Job<void, void | Er | CancelAllTimeout>
	}
}

function maxWaitFired(cancelAll: CancelJobs) {
	cancelAll._st |= TIME_LIMIT_FIRED
	cancelAll._onTgJobDone(cancelAll)
}

function unlinkFromAllJobs(obJob: Job) {
	let tgLink = obJob._tg
	while (tgLink !== VOID_LINK) {
		const nextLink = tgLink.nB
		removeOb(tgLink.b as Job, tgLink as JobsLink)
		removeTgOrChd(obJob, tgLink as JobsLink)
		disposeLink(tgLink)
		tgLink = nextLink
	}
}

export function linkWithAllJobs(jobs: Job[], obJob: Job, cancel = false) {

	// If all of the jobs are already settled, cancel would never settle
	// because no job would callback, so if there's no links, cancel
	// needs to settle immediately.
	let hasLink = false

	for (let i = 0; i < jobs.length; i++) {
		const job = jobs[i]!
		if (job._st & DONE) {
			continue
		}
		hasLink = true
		linkJobs(obJob, job)
		if (cancel) {
			cancelJob(job)
		}
	}
	if (!hasLink) {
		// Make jobIterator resume caller immediately.
		obJob._st |= DONE
	}
}

import { sys, type Link, VOID_OBJ, disposeLink, freshLink, Itrtor, iterRes, iterator, _Iterable, VoidObj, VOID_LINK, VoidLink, ensurePreviousYieldAndSetCallerJobNextSt, throwNotYielded, sysIterable } from "./system.js"
import { CANC_OK, CancOK, Er, Err, _Err } from "./errors.js"
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

const DUMMY_GEN = (function* () {})()
let self: Job

export type RibuGen<Ret = unknown> =
	Generator<unknown, Ret, unknown>

type RibuGenFn<Ret = unknown, Args extends unknown[] = unknown[]> =
	(...args: Args) => RibuGen<Ret>

type JobsLink = Link<Job, Job>
type JobChanLink = Link<Job, Chan>
type WaitingChdLink = JobsLink
type TgOrChdLink = JobChanLink | WaitingChdLink

type OnJobDone<T = Job> = (val: unknown, tg: Job, bPosInLink: T) => void
type CallbackLink<T = Job> = Link<OnJobDone<T>, T>
type ObserverLink<T = Job> = JobsLink | CallbackLink<T>

type SyncFn = () => unknown
type AsyncFn = () => Promise<unknown>
type OnEnd = SyncFn | AsyncFn | RibuGenFn
type OnEndLink = Link<OnEnd, Job>

/* **** State Flags **** */
const PARKED_CONTINUE = 1 << 0  // 1
const PARKED_JOB = 1 << 1  // 2
const PARKED_CANCEL = 1 << 2  // 4
const PARKED_CANCEL_ERR = 1 << 3  // 8
export const PARKED_SLEEP = 1 << 4  // 16
const PARKED_CH = 1 << 5  // 32
const WAITING_CHILDREN = 1 << 6  // 64
const CHILDREN_CANCELLED = 1 << 7  // 128
const WAITING_ONENDS = 1 << 8  // 256
export const CANCELLED = 1 << 9  // 512
export const DONE = 1 << 10  // 1024
const CANCOK = 1 << 11  // 2048
export const ERR_IN_GENFN = 1 << 12  // 4096
const ERR_IN_ONEND = 1 << 13  // 8192
const CANCEL_SIBLINGS_ON_ERR = 1 << 14  // 16384
const TIME_LIMIT_FIRED = 1 << 15  // 32768
// Used in situations where job is linking to other jobs, but target job
// notifies (and removes link) observer job immediately/synchronously.
const LINKING = 1 << 16  // 65536
// todo: implement this when [Symbol.dispose] is implemented
// const JOB_IN_POOL = 1 << 17  // 131072

export const PARKED = PARKED_CONTINUE | PARKED_JOB | PARKED_CANCEL | PARKED_CANCEL_ERR| PARKED_SLEEP | PARKED_CH
const HAD_ERR = ERR_IN_GENFN | ERR_IN_ONEND
export const ANY_ERR_OR_CANCOK = HAD_ERR | CANCOK

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
		const { _st } = this

		if (_st & WAITING_CHILDREN) {
			onChildDone(this, tgJob)
			return
		}

		// Parked at yield* tgJob or yield* tgJob.err/cancel/cancelErr.
		const { _st: tgSt } = tgJob

		const shouldThisJobFail =
			(_st & PARKED_JOB) && (tgSt & ANY_ERR_OR_CANCOK) ||
			(_st & PARKED_CANCEL) && (tgSt & ERR_IN_ONEND)

		if (shouldThisJobFail) {
			genFnFailed(this, _Err(this._nm, tgJob.val as Err))
			return
		}

		resumeJob(this, tgJob.val)
	}

	[Symbol.iterator]() {
		ensurePreviousYieldAndSetCallerJobNextSt(PARKED_JOB, "yield*")
		return jobIterator<OkRet>(this)
	}

	get err() {
		self = this
		ensurePreviousYieldAndSetCallerJobNextSt(PARKED_CONTINUE, ".err")
		return JOB_ITERABLE as _Iterable<GetterErr>
	}

	cancel() {
		handleCancel(this, ".cancel()", PARKED_CANCEL)
		return sysIterable as _Iterable<void>
	}

	cancelErr() {
		handleCancel(this, ".cancelErr()", PARKED_CANCEL_ERR)
		return sysIterable as _Iterable<void | Er>
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

function handleCancel(job: Job, opName: string, callerJobNextSt: Job["_st"]) {
	const callerJob = ensurePreviousYieldAndSetCallerJobNextSt(callerJobNextSt, opName)

	if (job._st & DONE) {
		iterRes.done = true
		iterRes.value = undefined
		return
	}

	cancelJob(job)

	const { _st, val } = job

	if (_st & DONE) {  // job settled synchronously
		if (callerJobNextSt & PARKED_CANCEL_ERR) {
			iterRes.done = true
			iterRes.value = _st & ERR_IN_ONEND ? val : undefined
			return
		}
		if (_st & ERR_IN_ONEND) {
			iterRes.done = false
			genFnFailed(callerJob, _Err(callerJob._nm, val))
			return
		}

		iterRes.done = true
		iterRes.value = undefined
		return
	}

	linkJobs(callerJob, job)
	iterRes.done = false
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
	const callerSt = callerJob._st
	const { _st } = job

	if (_st & DONE) {

		const shouldCallerFail =
			(callerSt & PARKED_JOB) && (_st & ANY_ERR_OR_CANCOK)

		if (shouldCallerFail) {
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

	if (genFnThrew || value instanceof Err) {
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
		.catch(e => handleOneOnEndResult(job, e, onEnd, true))
}

function handleOneOnEndResult(job: Job, onEndResult: unknown, onEnd: OnEnd, threw = false) {
	if (threw || onEndResult instanceof Err) {
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
		job.val = CANC_OK
		job._st = CANCOK
	}

	settleJobish(job)
}

type NotVoidObj<T> = T extends VoidObj ? never : T

function settleJobish(job: Job) {
	job._st |= DONE
	const { val } = job

	// Notify observers.
	let obLink = job._ob
	while (obLink !== VOID_LINK) {
		const nextLink = obLink.nA
		const observer = obLink.a
		if (typeof observer === "function") {
			type b = typeof obLink.b
			observer(val, job, obLink.b as NotVoidObj<b>)
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
const CANCEL_NOOP = DONE | WAITING_ONENDS
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


/* *********************  Job LLs Operations  ******************** */

/* Insert Link B:

	obj.LLHead
				\
		VL <- A -> VL

	obj.LLHead
				\
		VL <- B <-> A -> VL
*/

export function addObserver<T = Job>(job: Job, link: ObserverLink<T>) {
	let head = job._ob
	link.nA = head as ObserverLink<T>
	job._ob = link as ObserverLink
	if (head !== VOID_LINK) {
		head.pA = link as ObserverLink
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

export const CANCEL_ALL_OP_NAME = "cancel(...jobs)"
export const TIME_OUT = new Err("CancelTimeout", "")
export type Timeout = typeof TIME_OUT

export function cancel(...jobs: Job[]) {
	const cancelJobs = new CancelAll()
	linkWithAllJobs(jobs, cancelJobs, true)
	return cancelJobs as Pick<CancelAll, "err" | typeof Symbol.iterator | "maxWait">
}

class CancelAll extends Job<void, void | Er | Timeout> {

	constructor() {
		super(CANCEL_ALL_OP_NAME)
		this.val = undefined
	}

	[Symbol.iterator]() {
		// CancelAll uses the same semantics of PARKED_JOB's yield* and yield* .err
		ensurePreviousYieldAndSetCallerJobNextSt(PARKED_JOB, CANCEL_ALL_OP_NAME)
		return jobIterator<void>(this)
	}

	_onTgJobDone(tgJob: Job) {
		const { _st, _tg } = this
		if (_st & TIME_LIMIT_FIRED) {  // timeout fired
			this._tm = VOID_OBJ
			// reset ._st and .val in case some jobs already settled with Err.
			this._st = 0
			// settle with some sigil
			this.val = TIME_OUT
			// Make caller fail if it didn't call .err to handle the unhappy paths.
			this._st |= ERR_IN_GENFN
			unlinkFromAllJobs(this)
			settleJobish(this)
			return
		}
		if (tgJob._st & HAD_ERR) {
			addErrorToJobVal(this, tgJob.val as Err, ERR_IN_GENFN)
		}
		if (!(_st & LINKING) && _tg === VOID_LINK) {
			if (this._tm !== VOID_OBJ) {
				clearTimeout(this._tm as NodeJS.Timeout)
				this._tm = VOID_OBJ
			}
			settleJobish(this)
		}
	}

	maxWait(ms: number) {
		this._tm = setTimeout(maxWaitFired, ms, this)
		return this as Job<void, void | Er | Timeout>
	}
}

function maxWaitFired(cancelAll: CancelAll) {
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

	// Since jobs can settle synchronously, it could remove itself from obJob's
	// _tg, so obJob may think it has no more jobs to handle (via _tg check) and
	// it could erroneously settle immediately.
	// So, we need to tell obJob that it shouldn't settle until LINKING is off.
	// This is the most common scenario.
	obJob._st |= LINKING

	const len = jobs.length
	const lastIdx = len - 1
	for (let i = 0; i < len; i++) {
		const job = jobs[i]!
		if (job._st & DONE) {
			continue
		}
		// If this is the last job, we can turn off LINKING so obJob can settle.
		if (i === lastIdx) {
			obJob._st &= ~LINKING
		}
		linkJobs(obJob, job)
		if (cancel) {
			cancelJob(job)
		}
	}

	// If LINKING is on, it means, last job was skipped because it is already
	// settled. So we need to force obJob to settle immediately or it will
	// never settle via _onTgJobDone().
	if (obJob._st & LINKING) {
		obJob._st |= DONE  // Make jobIterator resume caller immediately.
	}
}

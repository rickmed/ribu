import { sys, type Link, VOID_OBJ, disposeLink, freshLink, Itrtor, iterRes, iterator, _Iterable, setYieldOp, VoidObj, VOID_LINK, MaybeL } from "./system.js"
import { _Err, Err, CANC_OK, CancOK, GenFnErr, OnEndErr, RibuErr, WaitingChldErr } from "./errors.js"
import { cancelSleep } from "./timers.js"
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

type ParentLink = JobsLink
type SyncFn = () => unknown
type AsyncFn = () => Promise<unknown>
type OnEnd = SyncFn | AsyncFn | RibuGenFn
type OnEndLink = Link<SyncFn, 1> | Link<AsyncFn, 2> | Link<RibuGenFn, 3>
type PrntOrOnEndLink = ParentLink | OnEndLink

type JobChanLink = Link<Job, Chan>
type TgOrChdLink =
	JobChanLink |
	JobsLink  // if blocked by a job or at waitingChildren()

type OnJobDone = (val: unknown, tg: Job) => void
type OnJobDoneLink = Link<OnJobDone, VoidObj>
type ObsLink = JobsLink | OnJobDoneLink

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
const HAS_PARENT = 1 << 14  // 16384
const HAS_OEND = 1 << 15  // 32768
// todo: implement this
// const JOB_IN_POOL = 1 << 16  // 65536

const PARKED_NOT_SLEEP = PARKED_CONTINUE | PARKED_JOB | PARKED_JOB_CANCEL | PARKED_CH
const PARKED = PARKED_NOT_SLEEP | PARKED_SLEEP
const HAD_ERR = ERR_IN_GENFN | ERR_IN_ONEND
export const ANY_ERR_OR_CANCOK = HAD_ERR | CANCOK


/*
	todo: store ends at the end of _prnt LL, store how many in flags

	todo: store _ob at the end of _tg, store how many in flags.
		so now we combine _tg, _chd and _ob into one LL.
		zeroOrOneYieldTg <-> zeroOrManyChd <-> zeroOrFewOb
*/

/** Job Class
 *  val:
 * 	Temporary slot for values; ch.put/rec, errors accumulation...
 * 	When job is settled, it stores its final value.
 *  _nm:
 *		Name of the generator function, or the Job-like (set by Ribu).
 *  _st:
 * 	Job state (flags).
 *  _gn:
 * 	Generator object.
 *  _tg:
 * 	A combined LL of the target the job is blocked by at yield* (tg) and its
 *  	children (chd), as "targets".
 * 	Since a job can only be blocked at yield* by one object at a time, we
 * 	store it as the head of the LL and store its respective PARKED_... flag.
 * 	The next links are to child jobs.
 *  _pr_oe:
 * 	A combined LL of link to parent job (pr) and onEnds (oe).
 * 	Since a job can only have one parent, we store it as the head
 * 	of the LL and store the flag HAS_PARENT. The next links are onEnds.
 *  _ob:
 * 	LL of things observing this job.
 */
export class Job<OkRet = unknown, GetterErr = unknown> {

	val = null as OkRet | GetterErr
	_nm: string
	_st = 0
	_gn: RibuGen
	_tg: MaybeL<TgOrChdLink> = VOID_LINK
	_pr_oe: MaybeL<PrntOrOnEndLink> = VOID_LINK
	_ob: MaybeL<ObsLink> = VOID_LINK

	constructor(name: string, gen?: RibuGen, parent?: Job) {
		this._gn = gen ?? DUMMY_GEN
		this._nm = name
		if (parent) {
			this._st |= HAS_PARENT
			const link = freshLink(parent, this)
			addParentOrOnEnd(this, link)
			addTgOrChd(parent, link)
		}
	}

	[Symbol.iterator]() {
		let { callerJobNextSt, runningJob: callerJob } = sys
		callerJobNextSt = callerJobNextSt || PARKED_JOB
		callerJob._st |= callerJobNextSt

		// reset ambient/temp state
		sys.callerJobNextSt = 0
		sys.yieldOpStr = ""

		if (this._st & DONE) {
			if (shouldJobFail(callerJob, this)) {
				genFnFailed(callerJob, this.val)
				iterRes.done = false
			}
			else {
				iterRes.done = true
				iterRes.value = this.val
			}
		}
		else {
			// todo: check this
			linkJobs(callerJob, this)
			iterRes.done = false
		}

		return iterator as Itrtor<OkRet>
	}

	get err() {
		setYieldOp("job.err", PARKED_CONTINUE)
		return this as unknown as _Iterable<GetterErr>
	}

	cancel() {
		// todo: subsribe caller immediately, after checking if user forgot
		// to yield* previous op.
		setYieldOp("job.cancel", PARKED_JOB_CANCEL)
		cancelJob(this)
		return this as unknown as _Iterable<CancOK>
	}

	cancelErr() {
		setYieldOp("job.cancelErr", PARKED_CONTINUE)
		cancelJob(this)
		return this as unknown as _Iterable<CancOK | Err<string>>
	}

	then(res: (val: OkRet) => void, rej: (err: GetterErr) => void) {
		if (this._st & DONE) {
			void ((this._st & ANY_ERR_OR_CANCOK) ? rej(this.val as GetterErr) : res(this.val as OkRet))
		}
		else {
			const link = freshLink(promOnJobDone, VOID_OBJ)
			addObserver(this, link)
		}

		function promOnJobDone(val: unknown, tgJob: Job) {
			void ((tgJob._st & ANY_ERR_OR_CANCOK) ? rej(val as GetterErr) : res(val as OkRet))
		}
	}

	get promErr() {
		return new Promise<GetterErr>((res) => {
			const link = freshLink(res as OnJobDone, VOID_OBJ)
			addObserver(this, link)
		})
	}

	onEnd(onEndFn: OnEnd) {
		addOnEnd(this, onEndFn)
	}

	cancelSiblingsOnErr() {
		this._st |= CANCEL_SIBLINGS_ON_ERR
	}

	isDone() {
		return this._st & DONE
	}
}

export function resumeJob(job: Job, val?: unknown) {
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

function execOnEnds(thisJob: Job) {
	if (thisJob._end === VOID_LINK) {
		settle(thisJob)
		return
	}

	thisJob._st |= WAITING_ONENDS

	const link = thisJob._end
	const onEnd = link.a
	const onEndType = link.b

	thisJob._end = link.nA
	disposeLink(link)

	if (onEndType === 1) {
		try {
			// eslint-disable-next-line no-var
			var retVal = (onEnd as SyncFn)()
		}
		catch (e) {
			retVal = e
		}
		if (retVal instanceof Error) {
			addErrorToJobVal(thisJob, OnEndErr(retVal, onEnd.name), ERR_IN_ONEND, "onEnd")
		}
		execOnEnds(thisJob)
		return
	}
	if (onEndType === 2) {
		(onEnd as AsyncFn)().then(
			() => {
				execOnEnds(thisJob)
			},
			(err) => {
				addErrorToJobVal(thisJob, OnEndErr(err, onEnd.name), ERR_IN_ONEND, "onEnd")
				execOnEnds(thisJob)
			}
		)
		return
	}
	if (onEndType === 3) {  // It's a Generator
		const job = new Job((onEnd as RibuGenFn)(), onEnd.name)

		// add an observer to thisJob



		const observer = new CustomObserver((val, tg) => {
			if (tg._st & ERR_IN_GENFN) {
				addErrorToJobVal(thisJob, OnEndErr(val, onEnd.name), ERR_IN_ONEND, "onEnd")
			}
			execOnEnds(thisJob)
		})

		resumeJob(job)
		return
	}

	onEndType satisfies never
}

function settle(thisJob: Job) {
	//
	if (thisJob._st & DONE) {
		return
	}

	// removeParent
	const { _pr_oe_ob: _prnt } = thisJob
	if (_prnt) {
		thisJob._pr_oe_ob = null
		removeLinkFromParent(_prnt)
		disposeLink(_prnt)
	}

	finishSettle(thisJob)
}

export function finishSettle(thisJob: Job) {
	const { _st, val } = thisJob

	if (_st & CANCELLED && !(_st & ERR_IN_ONEND)) {
		thisJob.val = CANC_OK
		thisJob._st = CANCOK
	}

	thisJob._st |= DONE

	// notify observers
	for (let link = thisJob._ob; link !== VOID_LINK; link = link.nA) {
		const observer = link.a
		if (typeof observer === "function") {
			observer(val, thisJob)
		}
		else {
			removeOb(thisJob, link as JobsLink)
			removeTgOrChd(observer as Job, link as JobsLink)
			disposeLink(link)
			onTgJobDone(observer as Job, thisJob)
		}
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

	addErrorToJobVal(job, child.val as RibuErr, ERR_IN_GENFN, "waitingChildren")

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
		cancelSleep(job)
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

type ErrType = "waitingChildren" | "onEnd"
export function addErrorToJobVal(job: Job, cause: RibuErr, st: Job["_st"], errType: ErrType) {
	const { _st } = job
	if (!(_st & HAD_ERR)) {
		const errMsg = _st & CANCELLED ? "cancelled" : ""

		const err = errType === "waitingChildren" ?
			WaitingChldErr(job._nm, cause, errMsg) :
			OnEndErr(cause, job._nm, errMsg)

		job.val = err
	}
	else {
		(job.val as RibuErr).addErr(cause)
	}

	job._st |= st
}

function addOnEnd(job: Job, onEndFn: OnEnd) {
	const fnCtorName = onEndFn.constructor.name
	const linkType =
		fnCtorName === "GeneratorFunction" ? 3 :
		fnCtorName === "AsyncFunction" ? 2 :
		1

	let link = freshLink(onEndFn, linkType) as OnEndLink

	const { _st, _pr_oe_ob } = job

	if (_pr_oe_ob === VOID_LINK) {
		addParentOrOnEnd(job, link)
	}
	else {  // job has parent (in _pr_oe_ob head)
		link.nA = _pr_oe_ob
	}


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

function addObserver(job: Job, link: ObsLink) {
	let head = job._ob
	job._ob = link
	link.nA = head
	head.pA = link
}

function removeOb(job: Job, link: ObsLink) {
	let { nA, pA } = link
	pA.nA = nA
	nA.pA = pA
	if (job._ob === link) {
		job._ob = nA
	}
}

// We can safely add blocking target (Tg) and child jobs (Chd) as head
// always because:
// Tg behaves like a stack Link, ie, it is added as head when job is blocked
// and removed when job is resumed, ie, go(), which adds childs, can never
// be called in between.
function addTgOrChd(job: Job, link: JobChanLink | ChildLink) {
	let oldHead = job._tg
	job._tg = link
	link.nB = oldHead
	oldHead.pB = link
}

function removeTgOrChd(job: Job, link: TgOrChdLink) {
	let { nB, pB } = link
	pB.nB = nB
	nB.pB = pB
	if (job._tg === link) {
		job._tg = nB
	}
	// No need to set link.nA/pA to void since caller should
	// dispose the link immediately.
}

function addParentOrOnEnd(job: Job, link: PrntOrOnEndLink) {
	let head = job._pr_oe
	job._pr_oe = link
	link.nA = head
	head.pA = link
}

function removeParentOrOnEnd(job: Job, link: PrntOrOnEndLink) {
	let { nA, pA } = link
	pA.nA = nA
	nA.pA = pA
	if (job._pr_oe === link) {
		job._pr_oe = nA
	}
}

export function popTgHead(thisJob: Job) {
	return removeTgOrChd(thisJob, thisJob._tg as Link<Ob, Tg>)
}

export function linkJobs(ob: Job, tg: Job) {
	const link = freshLink(ob, tg)
	addTgOrChd(ob, link)
	addObserver(tg, link)
}


//* ****************   User API   ****************************************** *//

export function go<Args extends unknown[], Ret>(genFn: RibuGenFn<Ret, Args>, ...args: Args) {
	const gen = genFn(...args)
	const job = new Job<Exclude<Ret, Error>, Ret | Err<string> | CancOK>(gen, genFn.name, sys.runningJob)
	resumeJob(job)
	return job
}

export function me(): Job {
	return sys.runningJob
}

export function onEnd(newOnEnd: OnEnd) {
	addOnEnd(sys.runningJob, newOnEnd)
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

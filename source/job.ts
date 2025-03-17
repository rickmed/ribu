import { sys, type Link, EMPTY, disposeLink, freshLink, Tg, Ob, Itrtor, iterRes, linkObAndTg, unlinkObAndTg as releaseObTgLink, Maybe, iterator, _Iterable, cleanSysOpSetup, setYieldOp } from "./system.ts"
import { _Err, Err, CANC_OK, CancOK, GenFnErr, OnEndErr, AnErr, WaitingChldErr } from "./errors.ts"
import { cancelSleep } from "./timers.ts"

// => thinking parents shouldn't cancel children if sibling failed.
//  maybe config jobs like go(genFn, ...ars).supervision(CancelSiblingsOnErr)


// todo: implement "unsub() to have something like trio's moveOnAfter()
// 	for jobs and job-helpers

// todo: remove Job stack from sys, put it here and use LL
// todo: clean-up documentation


//* **********************  Base Job Class  ******************************** *//

// State Flags
const INIT = 1 << 0  // 1
const PARKED_CONTINUE = 1 << 1  // 2
const PARKED_JOB = 1 << 2  // 4
const PARKED_JOB_CANCEL = 1 << 3  // 8
export const PARKED_SLEEP = 1 << 4  // 16
const PARKED_CH = 1 << 5  // 32
const WAITING_CHILDREN = 1 << 6  // 64
const WAITING_ONENDS = 1 << 7  // 128
export const CANCELLED = 1 << 8  // 256
export const DONE = 1 << 9  // 512
const CANCOK = 1 << 10  // 1024
export const ERR_IN_GENFN = 1 << 11  // 2048
const ERR_IN_ONEND = 1 << 12  // 4096
const CANCEL_SIBLINGS_ON_ERR = 1 << 13  // 8192

const PARKED = PARKED_CONTINUE | PARKED_JOB | PARKED_JOB_CANCEL | PARKED_CH
const ANY_ERR = ERR_IN_GENFN | ERR_IN_ONEND
export const ANY_ERR_OR_CANCOK = ANY_ERR | CANCOK
const ERR_IN_GENFN_OR_ONEND = ERR_IN_GENFN | ERR_IN_ONEND

/* JobBase Class
 *  _st = job state
 *  _ob = observers LL Head
 *    Objects waiting the result of this job.
 *  _tg = targets LL Head
 * 	Head of targets LL that I'm awaiting data/result, for example:
 *    	- A single target if job is blocked at yield*
 *    	- Several, for example:
 *    	  - If waiting for children (to finish normally or when cancelled)
 *    	  - Async onEnds to finish.
 *		Needed to remove Observer from all targets if cancelled.
 *  val = inbox/outbox for values like ch.put/rec, the final result of the job...
 *  _onTgDone = onTargetDone
 * 	Target calls this to notify job with data/result.
 */
export abstract class JobBase<OkRet = unknown, GetterErr = unknown> implements Ob, Tg {

	_st = INIT
	_tg: Maybe<Link<Ob, Tg>> = null
	_ob: Maybe<Link<Ob, Tg>> = null

	abstract val: GetterErr
	abstract _nm: string
	abstract _onTgDone(tgVal: unknown, tg: Tg): void
	abstract _fail(tgVal: unknown): void
	abstract _cancel(): void

	/* Insert Link B:

		obj.LLHead
					\
			n <-> A <-> n

		obj.LLHead
					\
			n <-> B <-> A <-> n
	*/

	_addTg(link: Link<Ob, Tg>) {  // as LL head
		let oldHead = this._tg
		this._tg = link
		link.nB = oldHead
		if (oldHead) {
			oldHead.pB = link
		}
	}
	_addOb(link: Link<Ob, Tg>) {  // as LL head
		let oldHead = this._ob
		this._ob = link
		link.nA = oldHead
		if (oldHead) {
			oldHead.pA = link
		}
	}
	_rmTg(link: Link<Ob, Tg>) {
		let { nB, pB } = link
		if (nB) {
			nB.pB = pB
		}
		if (pB) {
			pB.nB = nB
		}
		if (this._tg === link) {
			this._tg = nB
		}
		// No need to set link.nB/pB to null since caller should
		// dispose the link immediately.
	}
	_rmOb(link: Link<Ob, Tg>) {
		let { nA, pA } = link
		if (nA) {
			nA.pA = pA
		}
		if (pA) {
			pA.nA = nA
		}
		if (this._ob === link) {
			this._ob = nA
		}
		// No need to set link.nA/pA to null since caller should
		// dispose the link immediately.
	}

	[Symbol.iterator]() {
		const { callerJobToSetSt, runningJob: callerJob } = sys
		const callerJobSt = callerJobToSetSt !== 0 ? callerJobToSetSt : PARKED_JOB
		callerJob._st |= callerJobSt
		cleanSysOpSetup()

		if (this._st & DONE) {
			if (shouldCallerJobFail(callerJob, this)) {
				callerJob._fail(this.val)
				iterRes.done = false
			}
			else {
				iterRes.done = true
				iterRes.value = this.val
			}
		}
		else {
			linkObAndTg(callerJob, this)
			iterRes.done = false
		}

		return iterator as Itrtor<OkRet>
	}

	get err() {
		setYieldOp("job.err", PARKED_CONTINUE)
		return this as unknown as _Iterable<GetterErr>
	}

	cancel() {
		setYieldOp("job.cancel", PARKED_JOB_CANCEL)
		maybeExecCancel(this)
		return this as unknown as _Iterable<CancOK>
	}

	cancelErr() {
		setYieldOp("job.cancelErr", PARKED_CONTINUE)
		maybeExecCancel(this)
		return this as unknown as _Iterable<CancOK | Err<string>>
	}

	isDone() {
		return this._st & DONE
	}

	cancelSiblingsOnErr() {
		this._st |= CANCEL_SIBLINGS_ON_ERR
	}
}

function maybeExecCancel(job: JobBase) {
	const { _st } = job
	if (_st & CANCELLED || _st & DONE) {
		return
	}
	job._st |= CANCELLED
	job._cancel()
}

function shouldCallerJobFail(callerJob: Job, targetJob: Tg) {
	return (callerJob._st & PARKED_JOB) && (targetJob._st & ANY_ERR_OR_CANCOK) ||
		(callerJob._st & PARKED_JOB_CANCEL) && (targetJob._st & ERR_IN_ONEND)
}


//* ************************  Job Class  *********************************** *//

type RibuGen<Ret = unknown> =
	Generator<unknown, Ret, unknown>

type RibuGenFn<Ret = unknown, Args extends unknown[] = unknown[]> =
	(...args: Args) => RibuGen<Ret>

type SyncFn = () => unknown
type AsyncFn = () => Promise<unknown>
type OnEnd = SyncFn | AsyncFn | RibuGenFn
type OnEndLink = Link<SyncFn, 1> | Link<AsyncFn, 2> | Link<RibuGenFn, 3>


/* Job Class
 *  _gn = generator
 *  _nm = generator function name
 *  _chd = children jobs LL Head
 *  _prnt = parent job LL Head (even though jobs have max 1 parent)
 *  _ends = synchronous onEnds LL Head
 * 	.b in Link is true if onEnd is synchronous
 */
export class Job<OkRet = unknown, GetterErr = unknown> extends JobBase<OkRet, GetterErr> {

	_nm: string
	_gn: RibuGen
	_chd: Maybe<Link<Job, Job>> = null
	_prnt: Maybe<Link<Job, Job>> = null
	_ends: Maybe<OnEndLink> = null
	val: GetterErr = EMPTY as GetterErr

	constructor(gen: RibuGen, genFnName: string, parent?: Job) {
		super()
		this._gn = gen
		this._nm = genFnName
		if (parent) {
			linkParentChild(parent, this)
		}
	}

	_onTgDone(val: unknown, tg: Tg) {
		const { _st } = this

		if (_st & PARKED_CH) {
			resumeJob(this, val)
			return
		}
		if (shouldCallerJobFail(this, tg)) {
			this._fail(val)
			return
		}
		if (_st & WAITING_CHILDREN) {
			waitingChildren(this, val, tg)
			return
		}

		resumeJob(this, val)
	}

	_fail(tgVal: unknown) {
		genFnFailed(this, tgVal)
	}

	_cancel() {
		execCancelJob(this)
	}

	onEnd(onEndFn: OnEnd) {
		addOnEnd(this, onEndFn)
	}

	then(res: (val: OkRet) => void, rej: (err: GetterErr) => void) {
		const observer = new CustomObserver((val, tg) => {
			void ((tg._st & ANY_ERR_OR_CANCOK) ? rej(val as GetterErr) : res(val as OkRet))
		})
		linkObAndTg(observer, this)
	}

	get promErr() {
		return new Promise<GetterErr>((res) => {
			const observer = new CustomObserver((val) => {
				res(val as GetterErr)
			})
			linkObAndTg(observer, this)
		})
	}
}

export function resumeJob(thisJob: Job, val?: unknown) {
	thisJob._st = 0
	sys.pushJob(thisJob)

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
		const { done, value} = thisJob._gn.next()
		if (!done) {
			return
		}
		if (value instanceof Error) {
			genFnFailed(thisJob, value)
		}
		else {
			thisJob.val = value
			endProtocol(thisJob)
		}
	}
	catch (e) {
		genFnFailed(thisJob, e)
	}
	finally {
		sys.popJob()
	}
}

function genFnFailed(thisJob: Job, cause: unknown) {
	thisJob._st |= ERR_IN_GENFN
	thisJob._st |= CANCEL_SIBLINGS_ON_ERR
	thisJob.val = GenFnErr(thisJob._nm, cause)
	endProtocol(thisJob, true)
}

function endProtocol(thisJob: Job, cancelChildren = false) {
	let { _chd: childLink } = thisJob
	if (!childLink) {
		execOnEnds(thisJob)
		return
	}

	if (thisJob._st & WAITING_CHILDREN) {
		return
	}

	const prevSt = thisJob._st
	thisJob._st |= WAITING_CHILDREN

	// need to check if I'm already subscribed to children
	// ie, if _st & WAITING_CHILDREN

	thisJob._tg = childLink
	thisJob._chd = null
	while (childLink) {
		let childJob = childLink.b
		childJob._prnt = null

		// If child failed, enProtocol() will be called to cancel children,
		// so we check to not subscribe to child again.
		if (!(prevSt & WAITING_CHILDREN)) {
			childJob._addOb(childLink)
		}

		childLink = childLink.nB

		if (cancelChildren) {
			cancelJob(childJob)
		}
	}
}

// 1)
// maybe I can put _chd and _tg in the same LL
// since a job is parked in only at one target
// st = PARKED, i know head is not children
// 2)
// implement sleep as normal yieldable in same ._tg

/* PROBLEM:


*/

// genFn completes, now children are in _tg.

function waitingChildren(thisJob: Job, tgVal: unknown, tg: Tg) {
	let { _tg, _st } = thisJob

	if (!_tg) {
		_st &= ~WAITING_CHILDREN
		execOnEnds(thisJob)
		return
	}

	// if child settled with DONE_ECANCOK, it's ok
	if (tg._st & ERR_IN_GENFN_OR_ONEND) {
		addErrorToJobVal(thisJob, tgVal as AnErr, ERR_IN_GENFN, "waitingChildren")
		if (_st & CANCEL_SIBLINGS_ON_ERR) {
			// if i'm already waiting for children
			endProtocol(thisJob, true)
		}
	}
}

function execOnEnds(thisJob: Job) {
	if (!thisJob._ends) {
		settle(thisJob)
		return
	}

	thisJob._st |= WAITING_ONENDS

	const link = thisJob._ends
	const onEnd = link.a
	const onEndType = link.b

	thisJob._ends = link.nA
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
		// todo: change from CustomObserver to some static CB based
		const observer = new CustomObserver((val, tg) => {
			if (tg._st & ERR_IN_GENFN) {
				addErrorToJobVal(thisJob, OnEndErr(val, onEnd.name), ERR_IN_ONEND, "onEnd")
			}
			execOnEnds(thisJob)
		})
		linkObAndTg(observer, job)
		resumeJob(job)
		return
	}

	onEndType satisfies never
}

function settle(thisJob: Job) {
	removeParent(thisJob)
	execSettle(thisJob)
}

function removeParent(thisJob: Job) {
	const { _prnt } = thisJob
	if (_prnt) {
		thisJob._prnt = null
		removeLinkFromParent(_prnt)
		disposeLink(_prnt)
	}
}

export function execSettle(thisJob: JobBase) {
	const { _st, val } = thisJob

	if (_st & CANCELLED && !(_st & ERR_IN_ONEND)) {
		thisJob.val = CANC_OK
		thisJob._st = CANCOK
	}

	thisJob._st |= DONE
	notifyObservers(thisJob, val)
}

export function notifyObservers(thisJob: JobBase, tgVal: unknown) {
	while (thisJob._ob) {
		const link = thisJob._ob
		const ob = link.a
		releaseObTgLink(link)
		ob._onTgDone(tgVal, thisJob)
	}
}

export function cancelJob(thisJob: Job) {
	const { _st } = thisJob
	// todo: check if i need this check
	if (_st & CANCELLED || _st & DONE) {
		return
	}
	thisJob._st |= CANCELLED
	execCancelJob(thisJob)
}

function execCancelJob(thisJob: Job) {
	const { _st } = thisJob

	if (_st & PARKED_SLEEP) {
		cancelSleep(thisJob)
	}

	if (_st & PARKED) {
		// Unsubscribe from the single target blocking this job.
		const targetLink = thisJob._tg!
		targetLink.b._rmOb(targetLink)
		disposeLink(targetLink)
		thisJob._st &= ~PARKED
		thisJob._tg = null
	}

	endProtocol(thisJob, true)
}

// A LL is used as if parent is observer and child is target.
// Only .b (and .nB) properties are used, which by convention represent targets,
// and LL head is in parent._chd instead of parent._tg.
// .a (and .nA) properties are not used since a child can only have one parent,
// so ._prnt is just set to the link.
function linkParentChild(parent: Job, child: Job) {
	let link = freshLink(parent, child)
	child._prnt = link

	let oldChdHead = parent._chd
	parent._chd = link
	link.nB = oldChdHead
	if (oldChdHead) {
		oldChdHead.pB = link
	}
}

function removeLinkFromParent(link: Link<Job, Job>) {
	let { nB, pB } = link
	if (nB) {
		nB.pB = pB
	}
	if (pB) {
		pB.nB = nB
	}
	let parent = link.a
	if (parent._chd === link) {
		parent._chd = nB
	}
}

class CustomObserver implements Ob {
	declare _tg: Link<Ob, Job>
	constructor(private onTgDone: (val: unknown, tg: Tg) => void) {}
	_onTgDone(val: unknown, tg: Tg) {
		this.onTgDone(val, tg)
	}
	_addTg() {}
	_rmTg() {}
}

type ErrType = "waitingChildren" | "onEnd"

export function addErrorToJobVal(job: JobBase, cause: AnErr, st: JobBase["_st"], errType: ErrType) {
	const { _st } = job
	if (!(_st & ANY_ERR)) {
		const errMsg = _st & CANCELLED ? "cancelled" : ""

		const err = errType === "waitingChildren" ?
			WaitingChldErr(job._nm, cause, errMsg) :
			OnEndErr(cause, job._nm, errMsg)

		job.val = err
	}
	else {
		(job.val as AnErr).addErr(cause)
	}
	job._st |= st
}

function addOnEnd(thisJob: Job, onEndFn: OnEnd) {
	const fnCtorName = onEndFn.constructor.name
	const linkTypeSignal =
		fnCtorName === "AsyncFunction" ? 2 :
		fnCtorName === "GeneratorFunction" ? 3
		: 1

	let link = freshLink(onEndFn, linkTypeSignal) as OnEndLink

	let oldHead = thisJob._ends
	thisJob._ends = link
	link.nA = oldHead
	if (oldHead) {
		oldHead.pA = link
	}
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
	- Helpers never cancel jobs, unless manual helper.cancel().
	- On yield*, it fails callerJob (and only unsub from jobs).


=> IMPLEMENTATION. Need:


- get err()
allOrErr
	i think works as is.
allSettled
first
firstOK


- cancel():
	- cancell inner jobs
	- jobIsh, cancels children (at _chd)
- cancelErr


*/



// export function cancel(...jobs: Job[]) {
// 	let callerJob = sys.runningJob
// 	callerJob._st |= PARKED_JOB_CANCEL
// 	const observer = new CancelAll()
// 	subscribeToAllJobs(jobs, observer, true)
// }

// class CancelAll extends JobBase {

// 	_nm = "cancel"

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

export function subscribeToAllJobs(jobs: Job[], ob: Ob, cancel = false) {
	for (let i = 0; i < jobs.length; i++) {
		const job = jobs[i]!
		if (job._st & DONE) {
			ob._onTgDone(job.val, job)
			return
		}
		linkObAndTg(ob, job)
		if (cancel) {
			cancelJob(job)
		}
	}
}

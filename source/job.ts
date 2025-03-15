import { sys, type Link, EMPTY, disposeLink, freshLink, Tg, Ob, Itrtor, iterRes, linkObAndTg, unlinkObAndTg, Maybe, iterator, _Iterable, cleanSysOpSetup, setYieldOp } from "./system.ts"
import { _Err, Err, CANC_OK, CancOK } from "./errors.ts"
import { cancelSleep } from "./timers.ts"

// implement "unsub() to have something like trio's moveOnAfter()
// for jobs and job-helpers
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
const CANCELLED = 1 << 8  // 256
export const DONE = 1 << 9  // 512
const DONE_CANCOK = 1 << 10  // 1024
const ERR_IN_GENFN = 1 << 11  // 2048
const ERR_IN_ONEND = 1 << 12  // 4096

const PARKED = PARKED_CONTINUE | PARKED_JOB | PARKED_JOB_CANCEL | PARKED_CH
const ANY_ERR = ERR_IN_GENFN | ERR_IN_ONEND
export const ANY_ERR_OR_CANCOK = ANY_ERR | DONE_CANCOK
const ERR_IN_ONENDS_OR_ONEND = ERR_IN_ONEND | ERR_IN_GENFN

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
	abstract _execFail(tgVal: unknown): void

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
		// no need to set link.nB/pB to null since it will be disposed immediately
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
		// no need to set link.nA/pA to null since it will be disposed immediately
	}

	[Symbol.iterator]() {
		const { callerJobToSetSt, runningJob: callerJob } = sys
		const callerJobSt = callerJobToSetSt !== 0 ? callerJobToSetSt : PARKED_JOB
		callerJob._st |= callerJobSt
		cleanSysOpSetup()

		if (this._st & DONE) {
			if (shouldCallerJobFail(callerJob, this)) {
				callerJob._execFail(this.val)
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
}

function shouldCallerJobFail(callerJob: Job, targetJob: Tg) {
	const { _st: targetSt } = targetJob
	return (callerJob._st & PARKED_JOB) && (targetSt & ANY_ERR_OR_CANCOK) ||
		(callerJob._st & PARKED_JOB_CANCEL) && (targetSt & ERR_IN_ONEND)
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
			this._execFail(val)
			return
		}
		if (_st & WAITING_CHILDREN) {
			waitingChildren(this, val, tg)
			return
		}

		resumeJob(this, val)
	}

	_execFail(tgVal: unknown) {
		genFnFailed(this, tgVal)
	}

	cancel() {
		cancelJob(this)
		setYieldOp("job.cancel", PARKED_JOB_CANCEL)
		return this as unknown as _Iterable<CancOK>
	}

	cancelErr() {
		cancelJob(this)
		setYieldOp("job.cancelErr", PARKED_CONTINUE)
		return this as unknown as _Iterable<CancOK | Err>
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

function genFnFailed(job: Job, e: unknown) {
	job._st |= ERR_IN_GENFN
	job.val = _Err(e, job._nm)
	endProtocol(job, true)
}

function endProtocol(thisJob: Job, cancelChildren = false) {
	let { _chd: childLink } = thisJob
	if (!childLink) {
		execOnEnds(thisJob)
		return
	}

	thisJob._st |= WAITING_CHILDREN

	let currentLink = childLink as Maybe<Link<Job, Job>>
	while (currentLink) {
		const nextLink = currentLink.nA
		let childJob = currentLink.b

		// Repurpose parent-child link as observer-target link
		thisJob._addTg(currentLink)
		childJob._addOb(currentLink)
		childJob._prnt = null

		if (cancelChildren) {
			cancelJob(childJob)
		}

		currentLink = nextLink
	}
}

function waitingChildren(thisJob: Job, tgVal: unknown, tg: Tg) {
	let { _tg } = thisJob

	if (_tg) {
		thisJob._st &= ~WAITING_CHILDREN
		execOnEnds(thisJob)
		return
	}

	thisJob._st |= WAITING_CHILDREN

	// if child settled with DONE_ECANCOK, it's ok
	if (tg._st & ERR_IN_ONENDS_OR_ONEND) {
		addErrorToJobVal(thisJob, tgVal as Err, ERR_IN_GENFN)
		endProtocol(thisJob, true)
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
	const type = link.b

	thisJob._ends = link.nA
	disposeLink(link)

	if (type === 1) {
		try {
			// eslint-disable-next-line no-var
			var retVal = (onEnd as SyncFn)()
		}
		catch (e) {
			retVal = wrapIfNotError(e, onEnd.name)
		}
		if (retVal instanceof Err) {
			addErrorToJobVal(thisJob, retVal, ERR_IN_ONEND)
		}
		execOnEnds(thisJob)
	}
	else if (type === 2) {
		(onEnd as AsyncFn)().then(
			() => {
				execOnEnds(thisJob)
			},
			(err) => {
				addErrorToJobVal(thisJob, wrapIfNotError(err, onEnd.name), ERR_IN_ONEND)
				execOnEnds(thisJob)
			}
		)
	}
	else {  // It's a Generator
		const job = new Job((onEnd as RibuGenFn)(), onEnd.name)
		// todo: change from CustomObserver to some static CB based
		const observer = new CustomObserver((val, tg) => {
			if (tg._st & ERR_IN_GENFN) {
				addErrorToJobVal(thisJob, val as Err, ERR_IN_ONEND)
			}
			execOnEnds(thisJob)
		})
		linkObAndTg(observer, job)
		resumeJob(job)
	}

	// todo: set unreachable here
}

function settle(thisJob: Job) {
	const { _st, val } = thisJob

	if (_st & CANCELLED && !(_st & ERR_IN_GENFN)) {
		thisJob.val = CANC_OK
		thisJob._st = DONE_CANCOK
	}

	thisJob._st |= DONE

	const { _prnt } = thisJob
	if (_prnt) {
		thisJob._prnt = null
		removeLinkFromParent(_prnt)
		disposeLink(_prnt)
	}

	notifyObservers(thisJob, val)
}

export function notifyObservers(thisJob: JobBase, tgVal: unknown) {
	while (thisJob._ob) {
		const link = thisJob._ob
		link.a._onTgDone(tgVal, thisJob)
		thisJob._ob = link.nA
		unlinkObAndTg(link)
	}
}

function cancelJob(thisJob: Job) {
	const { _st } = thisJob
	// todo: check if i need this check
	if (_st & CANCELLED || _st & DONE) {
		return
	}

	thisJob._st |= CANCELLED

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

function linkParentChild(parent: Job, child: Job) {
	let link = freshLink(parent, child)
	child._prnt = link

	let oldChdHead = parent._chd
	parent._chd = link
	link.nA = oldChdHead
	if (oldChdHead) {
		oldChdHead.pA = link
	}
}

function removeLinkFromParent(link: Link<Job, Job>) {
	let { nA, pA } = link
	if (nA) {
		nA.pA = pA
	}
	if (pA) {
		pA.nA = nA
	}
	let parent = link.a
	if (parent._chd === link) {
		parent._chd = nA
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

function wrapIfNotError(x: unknown, fnName: string): Error {
	return x instanceof Error ? x : new Err("ThrownValIsNotError", "", fnName, x)
}

export function addErrorToJobVal(job: JobBase, err: Error, st: JobBase["_st"]) {
	const { _st } = job
	if (_st & ANY_ERR) {
		(job.val as Err).addError(err)
	}
	else {
		job.val = _Err(err, job._nm, _st & CANCELLED ? "cancelled" : "")
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

export type NotErrs<Ret> = Exclude<Ret, Error>

export function go<Args extends unknown[], Ret>(genFn: RibuGenFn<Ret, Args>, ...args: Args) {
	const gen = genFn(...args)
	const job = new Job<NotErrs<Ret>, Ret | Err | CancOK>(gen, genFn.name, sys.runningJob)
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

allOrErr  (could cancel)
	- fails if one job fails
allSettled
first   (could cancel)
firstOK  (could cancel)

FAIL/CANCELLING INNER:
	- Helpers never cancel jobs, unless called helper.cancel() manually by user.
	- On yield*, it fails callerJob (and only unsub from jobs).
	- It implements .cancel() if user wants to manually cancel all passed-in jobs.

=> IMPLEMENTATION. Need:


- get err()


- cancel():
	- cancell inner jobs
	- jobIsh, cancels children (at _chd)
- cancelErr


*/



export function cancel(...jobs: Job[]) {
	let callerJob = sys.runningJob
	callerJob._st |= PARKED_JOB_CANCEL
	const observer = new CancelAll()
	subscribeToAllJobs(jobs, observer, true)
}

class CancelAll extends JobBase {

	_nm = "cancel"

	_onTgDone(tgVal: unknown, tg: Job) {
		const { val, _tg } = this
		if (tg._st & ERR_IN_ONEND) {
			addErrorToJobVal(this, tgVal as Err)
		}
		if (!_tg) {
			this._st |= DONE
			notifyObservers(this, val)
		}
	}
}

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

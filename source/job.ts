import { sys, type Link, EMPTY, disposeLink, freshLink, Tg, Ob, Iter, iterRes, linkObAndTg, unlinkObAndTg, Maybe } from "./shared.ts"
import { _Err, Err, ECancOK, ThrownValIsNotError } from "./errors.ts"

// todo: remove Job stack from sys, put it here and use LL
// todo: clean-up documentation

//* **********************  Base Job Class  ******************************** *//

export const YIELD = 5678

// State Flags
const RUNNING = 1 << 0
const PARKED_CONTINUE = 1 << 1
const PARKED_JOB = 1 << 2
const PARKED_JOB_CANCEL = 1 << 3
export const PARKED_SLEEP = 1 << 4
const PARKED_CH_PUT = 1 << 5
const WAITING_CHILDREN = 1 << 6
const WAITING_ONENDS = 1 << 7
const CANCELLING = 1 << 8
// Even if DONE is set, can have other flags indicating, eg, it settled with an error
export const DONE = 1 << 9
const DONE_ECANCOK = 1 << 10
// DONE_ERR is set if job settled with ::Err other than ECancOK
const DONE_ERR = 1 << 11

const PARKED = PARKED_CONTINUE | PARKED_JOB | PARKED_JOB_CANCEL | PARKED_CH_PUT
export const DONE_ANY_ERR = DONE_ERR | DONE_ECANCOK

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
export abstract class JobBase<YieldRet = unknown, ErrRet = unknown> implements Ob, Tg {
	abstract _nm: string
	abstract _onTgDone(val: unknown, tg: Tg): void

	_st = RUNNING
	_tg: Maybe<Link<Ob, Tg>> = null
	_ob: Maybe<Link<Ob, Tg>> = null
	val = EMPTY as YieldRet

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
		prepareCallerJobToFailIfIFail()
		sys.targetJob = this
		return jobIterator as Iter<YieldRet>
	}

	get err() {
		const callerJob = sys.runningJob
		callerJob._st &= ~PARKED
		callerJob._st |= PARKED_CONTINUE
		sys.targetJob = this
		return jobIterable as Iterable<ErrRet>
	}
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
export class Job<YieldRet = unknown, ErrRet = unknown> extends JobBase<YieldRet, ErrRet> {

	_gn: RibuGen
	_nm: string
	_chd: Maybe<Link<Job, Job>> = null
	_prnt: Maybe<Link<Job, Job>> = null
	_ends: Maybe<OnEndLink> = null

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
		const { _st: tgSt } = tg

		if (_st & PARKED_JOB) {
			if (tgSt & DONE_ANY_ERR) {
				this.val = _Err(val, this._nm) as YieldRet
				endProtocol(this, true)
				return
			}
			resumeJob(this, val)
			return
		}
		if (_st & PARKED_JOB_CANCEL) {
			if (tgSt & DONE_ECANCOK) {
				resumeJob(this, val)
				return
			}
			// cancelled target should only settle with ECancOK or Err
			endProtocol(this, true)
			return
		}
		if (_st & PARKED_CONTINUE) {
			resumeJob(this, val)
			return
		}
		if (_st & WAITING_CHILDREN) {
			waitingChildren(this, val, tg)
			return
		}
	}

	cancel() {
		let callerJob = sys.runningJob
		callerJob._st &= ~PARKED
		callerJob._st |= PARKED_JOB_CANCEL
		cancelJob(this)
		sys.targetJob = this
		return jobIterable as Iterable<ECancOK>
	}

	onEnd(onEndFn: OnEnd) {
		addOnEnd(this, onEndFn)
	}

	then(res: (val: YieldRet) => void, rej: (err: ErrRet) => void) {
		const observer = new CustomObserver((val, tg) => {
			void ((tg._st & DONE_ANY_ERR) ? rej(val as ErrRet) : res(val as YieldRet))
		})
		linkObAndTg(observer, this)
	}

	get pErr() {
		return new Promise((res) => {
			const observer = new CustomObserver((val) => {
				res(val)
			})
			linkObAndTg(observer, this)
		})
	}
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

function cancelJob(thisJob: Job) {
	const { _st } = thisJob
	if (_st & CANCELLING) {
		return
	}

	thisJob._st |= CANCELLING

	if (_st & PARKED_SLEEP) {
		clearTimeout(thisJob._tg as unknown as NodeJS.Timeout)
		thisJob._tg = null
	}

	if (_st & PARKED) {
		// Unsubscribe from the single target blocking this job.
		const targetLink = thisJob._tg!
		targetLink.b._rmOb(targetLink)
		disposeLink(targetLink)
		thisJob._st &= ~PARKED
		thisJob._tg = null
	}
	else if (_st & WAITING_CHILDREN) {
		// At WAITING_CHILDREN state, children are in ._tg, not in ._chd, and
		// thisJob in their ._ob, not in their ._prnt.
		// So we just iterate over them and trigger their cancellation and they'll
		// notify thisJob when their cancellation is done.
		for (let childLink = thisJob._tg; childLink; childLink = childLink.nA) {
			cancelJob(childLink.b as Job)
		}
		return
	}
	else if (_st & WAITING_ONENDS) {
		return
	}

	endProtocol(thisJob, true)
}

function endProtocol(thisJob: Job, cancelChildren = false) {
	let { _chd: childLink } = thisJob
	if (!childLink) {
		execOnEnds(thisJob)
		return
	}

	thisJob._st |= WAITING_CHILDREN

	do {
		let childJob = childLink.b
		if (cancelChildren) {
			cancelJob(childJob)
		}

		// can reuse the same parent-child link but move it into ob/tg LLs
		thisJob._addTg(childLink)
		childJob._addOb(childLink)
		childJob._prnt = null

		childLink = childLink.nA

	} while (childLink)

	thisJob._chd = null
}

export function resumeJob(thisJob: Job, val?: unknown) {

	thisJob._st |= RUNNING

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

	// Operations that yield (not yield*) are side effect only, so iterRes will
	// be ignored.

	iterRes.done = true
	iterRes.value = val

	try {
		const { done, value} = thisJob._gn.next()
		if (done) {
			if (value instanceof Err) {
				thisJob._st |= DONE_ERR
				thisJob.val = _Err(value, thisJob._nm)
			}
			else {
				thisJob.val = value
			}
			endProtocol(thisJob)
			return
		}
		if (value !== YIELD) {
			// todo: yell at user
		}
	}
	catch (e) {
		thisJob._st |= DONE_ERR
		thisJob.val = _Err(e, thisJob._nm)
		endProtocol(thisJob, true)
	}
	finally {
		thisJob._st &= ~RUNNING
		sys.popJob()
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
	if (tg._st & DONE_ERR) {
		addErrorToJobVal(thisJob, tgVal as Err)
		endProtocol(thisJob, true)
	}
}

export function addErrorToJobVal(jobish: JobBase, err: Error) {
	const { _st } = jobish
	if (_st & DONE_ERR) {
		(jobish.val as Err).addError(err)
	}
	else {
		jobish.val = _Err(err, jobish._nm)
		jobish._st |= DONE_ERR
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
			retVal = wrapIfNotError(e)
		}
		if (retVal instanceof Err) {
			addErrorToJobVal(thisJob, retVal)
		}
		execOnEnds(thisJob)
	}
	else if (type === 2) {
		(onEnd as AsyncFn)().then(
			() => {
				execOnEnds(thisJob)
			},
			(err) => {
				addErrorToJobVal(thisJob, wrapIfNotError(err))
				execOnEnds(thisJob)
			}
		)
	}
	else {  // It's a Generator
		const job = new Job((onEnd as RibuGenFn)(), onEnd.name)
		const observer = new CustomObserver((val, tg) => {
			if (tg._st & DONE_ERR) {
				addErrorToJobVal(thisJob, val as Err)
			}
			execOnEnds(thisJob)
		})
		linkObAndTg(observer, job)
		resumeJob(job)
	}
}

class CustomObserver implements Ob {
	declare _tg: Link<Ob, Tg>
	constructor(private onTgDone: (val: unknown, tg: Tg) => void) {}
	_onTgDone(val: unknown, tg: Tg) {
		this.onTgDone(val, tg)
	}
	_addTg() {}
	_rmTg() {}
}

function wrapIfNotError(x: unknown): Error {
	return x instanceof Error ? x : new ThrownValIsNotError(x)
}

function settle(thisJob: Job) {
	const { _st, val } = thisJob

	if (_st & CANCELLING && !(_st & DONE_ERR)) {
		thisJob._st = DONE_ECANCOK
		thisJob.val = new ECancOK(thisJob._nm)
	}

	thisJob._st |= DONE

	const parentLink = thisJob._prnt
	if (parentLink) {
		thisJob._prnt = null
		removeLinkFromParent(parentLink)
		disposeLink(parentLink)
	}

	notifyObservers(thisJob, val)
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

export function notifyObservers(tgJob: JobBase, tgVal: unknown) {
	while (tgJob._ob) {
		const link = tgJob._ob
		link.a._onTgDone(tgVal, tgJob)
		tgJob._ob = link.nA
		unlinkObAndTg(link)
	}
}

export const jobIterator = {
	next() {
		let callerJob = sys.runningJob
		const { _st: thisJobSt, val } = sys.targetJob
		if (thisJobSt & DONE) {
			const callerJobSt = callerJob._st
			if (
				(callerJobSt & PARKED_JOB) && (thisJobSt & DONE_ANY_ERR) ||
				(callerJobSt & PARKED_JOB_CANCEL) && (thisJobSt & DONE_ERR)
			) {
				callerJob.val = _Err(val, callerJob._nm)
				callerJob._st |= DONE_ERR
				endProtocol(callerJob, true)
				iterRes.done = false
				iterRes.value = YIELD
			}
			else {
				iterRes.done = true
				iterRes.value = val
			}
		}
		else {
			linkObAndTg(callerJob, sys.targetJob)
			iterRes.done = false
			iterRes.value = YIELD
		}
		return iterRes
	}
}

export type Iterable<V> = {
	[Symbol.iterator]: () => Iter<V>
}

const jobIterable = {
	[Symbol.iterator]() {
		return jobIterator
	}
}

export function prepareCallerJobToFailIfIFail() {
	let callerJob = sys.runningJob
	callerJob._st &= ~PARKED
	callerJob._st |= PARKED_JOB
}



//* **********************  cancel(...jobs) ******************************** *//

export function cancel(...jobs: Job[]) {
	prepareCallerJobToFailIfIFail()
	subscribeToAllJobs(jobs, new CancelAll(), true)
}

class CancelAll extends JobBase {
	_nm = "cancel"

	_onTgDone(tgVal: unknown, tg: Tg) {
		const { val, _tg } = this
		if (tg._st & DONE_ERR) {
			addErrorToJobVal(this, tgVal as Err)
		}
		if (_tg) {
			this._st |= DONE
			notifyObservers(this, val)
		}
	}
}

export function subscribeToAllJobs(jobs: Job[], observer: Ob, cancel = false) {
	for (let i = 0; i < jobs.length; i++) {
		const job = jobs[i] as Job
		if (cancel) {
			cancelJob(job)
		}
		linkObAndTg(observer, job)
	}
}



//* ************************  User API  ************************************ *//

export type NotErrs<Ret> = Exclude<Ret, Error>
export type RibuErrs = ECancOK | Err

export function go<Args extends unknown[], Ret>(genFn: RibuGenFn<Ret, Args>, ...args: Args) {
	const gen = genFn(...args)
	const job = new Job<NotErrs<Ret>, Ret | RibuErrs>(gen, genFn.name, sys.runningJob)
	resumeJob(job)
	return job
}

export function me(): Job {
	return sys.runningJob
}

export function onEnd(newOnEnd: OnEnd) {
	addOnEnd(sys.runningJob, newOnEnd)
}

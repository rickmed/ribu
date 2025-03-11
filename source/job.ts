import { sys, type Link, EMPTY, disposeLink, freshLink, EMPTY_LINK, Tg, Ob, Iter, iterRes, linkObAndTg, unlinkObAndTg } from "./shared.ts"
import { Err, ECancOK, JSError } from "./errors.ts"

// todo: sleep
// todo: can use extra flags instead of checking if job.val is instance of Err
// to add error

/* ***************  Connect Observers <-> Targets via LLs  *********************
EL: Empty Link

Insert Link B:

	obj.LLHead
				\
		EL <-> A <-> EL

	obj.LLHead
				\
	   EL <-> B <-> A <-> EL

 */

function addLinkToLLAsHead<T>(obj: T, propName: keyof T, link: Link): void {
	let oldHead = obj[propName] as unknown as Link
	// Set the new link as the head
	;(obj[propName] as unknown) = link
	// Connect new link and old head
	link.nB = oldHead
	oldHead.pB = link
}

function removeLinkFromLL<T>(obj: T, propName: keyof T, link: Link): void {
	link.pB.nB = link.nB
	link.nB.pB = link.pB
	// If the removed link was the head, update the head pointer
	if (link.pB === EMPTY_LINK) {
		(obj[propName] as unknown) = link.nB
	}
}



//* *********************  Ambient variables  ****************************** *//

// todo: change stack to LL
let jobStack: Array<Job> = []
let self!: Job



//* ************************  Job Class  *********************************** *//

type Gen<Ret = unknown> = Generator<unknown, Ret, unknown>

type SyncFn = () => unknown
type AsyncFn = () => Promise<unknown>
type GenFn = RibuGenFn
type OnEnd = SyncFn | AsyncFn | GenFn
type OnEndLink = Link<SyncFn, 1> | Link<AsyncFn, 2> | Link<GenFn, 3>

type State = number

/* Job continue/fail _st semantics

	- const res = yield* job.err   // res is All
		PARKED_CONTINUE

	- const res = yield* job    // caller faisls at ::Error
		PARKED_JOB

	- yield* job.cancel()
	- yield* cancel(jobs)
		// caller resumes at EcancOK even though EcancOK is ::Error
		PARKED_JOB_CANCEL
*/

const PARKED_CONTINUE = 1 << 0
const PARKED_JOB = 1 << 1
const PARKED_JOB_CANCEL = 1 << 2
const PARKED_SLEEP = 1 << 3
const WAITING_CHILDREN = 1 << 4
const WAITING_ONENDS = 1 << 5
const CANCELLING = 1 << 6
const DONE_OK = 1 << 7
const DONE_ECANCOK = 1 << 8
const DONE_ERR = 1 << 9

const PARKED = PARKED_CONTINUE | PARKED_JOB | PARKED_JOB_CANCEL | PARKED_SLEEP
const DONE = DONE_OK | DONE_ECANCOK | DONE_ERR

/* Job Class
 *  _gn = generator
 *  _nm = generator function name
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
 *  _chd = children jobs LL Head
 *  _prnt = parent job LL Head (even though jobs have max 1 parent)
 *  _ends = synchronous onEnds LL Head
 * 	.b in Link is true if onEnd is synchronous
 *  val = inbox/outbox for values like ch.put/rec, the final result of the job...
 *  _onTgDone = onTargetDone
 * 	Target calls this to notify job with data/result.
 */
export class Job<NotErrs = unknown, All = unknown> implements Ob, Tg {

	_gn: Gen
	_nm: string
	_st = 0 as State
	_tg = EMPTY_LINK as Link<Ob, Tg>
	_ob = EMPTY_LINK as Link<Ob, Tg>
	_chd = EMPTY_LINK as Link<Job, Job>
	_prnt = EMPTY_LINK as Link<Job, Job>
	_ends = EMPTY_LINK as OnEndLink
	val = EMPTY as NotErrs | All

	constructor(gen: Gen, genFnName: string, parent?: Job) {
		this._gn = gen
		this._nm = genFnName
		if (parent) {
			// link parent-child
			const link = freshLink(parent, this)
			this._prnt = link
			addLinkToLLAsHead(parent, "_chd", link)
		}
	}

	_onTgDone(val: unknown) {
		const { _st } = this

		if (_st & PARKED_JOB) {
			if (val instanceof Err) {
				this.val = new Err(val, this._nm) as All
				endProtocol(this, true)
				return
			}
			resumeJob(this, val)
			return
		}
		if (_st & PARKED_JOB_CANCEL) {
			if (val instanceof ECancOK) {
				resumeJob(this, val)
				return
			}
			// should receive only ECancOK or Error at PARKED_JOB_CANCEL
			endProtocol(this, true)
			return
		}
		if (_st & PARKED_CONTINUE) {
			resumeJob(this, val)
			return
		}
		if (_st & WAITING_CHILDREN) {
			waitingChildren(this, val)
			return
		}
	}
	_addTg(link: Link<Ob, Tg>) {
		addLinkToLLAsHead(this, "_tg", link)
	}
	_rmTg(link: Link<Ob, Tg>) {
		removeLinkFromLL(this, "_tg", link)
	}
	_addOb(link: Link<Ob, Tg>) {
		addLinkToLLAsHead(this, "_ob", link)
	}
	_rmOb(link: Link<Ob, Tg>) {
		removeLinkFromLL(this, "_ob", link)
	}

	[Symbol.iterator]() {
		const callerJob = sys.runningJob
		callerJob._st &= ~PARKED
		callerJob._st |= PARKED_JOB
		self = this
		return jobIterator as Iter<NotErrs>
	}

	get err() {
		const callerJob = sys.runningJob
		callerJob._st &= ~PARKED
		callerJob._st |= PARKED_CONTINUE
		self = this
		return jobIterable as Iterable<All>
	}

	cancel() {
		const callerJob = sys.runningJob
		callerJob._st &= ~PARKED
		callerJob._st |= PARKED_JOB_CANCEL
		cancelJob(this)
		self = this
		return jobIterable as Iterable<undefined>
	}

	onEnd(onEndFn: OnEnd) {
		addOnEnd(this, onEndFn)
	}

	then(res: (val: NotErrs) => void, rej: (err: unknown) => void) {
		const observer = new CustomObserver((val) => {
			void ((val instanceof Err) ? rej(val) : res(val as NotErrs))
		})
		linkObAndTg(observer, this)
	}
}

function addOnEnd(thisJob: Job, onEndFn: OnEnd) {
	const fnCtorName = onEndFn.constructor.name
	const linkTypeSignal =
		fnCtorName === "AsyncFunction" ? 2 :
			fnCtorName === "GeneratorFunction" ? 3
				: 1
	const link = freshLink(onEndFn, linkTypeSignal)
	addLinkToLLAsHead(thisJob, "_ends", link)
}

function cancelJob(thisJob: Job) {
	const { _st } = thisJob
	if (_st & CANCELLING) {
		return
	}

	thisJob._st |= CANCELLING

	if (_st & PARKED) {
		// Unsubscribe from the single target blocking this job.
		const targetLink = thisJob._tg
		targetLink.b._rmOb(targetLink)
		disposeLink(targetLink)
		thisJob._st &= ~PARKED
		thisJob._tg = EMPTY_LINK as Link<Ob, Tg>
	}
	else if (_st & WAITING_CHILDREN) {
		// At WAITING_CHILDREN state, children are in ._tg, not in ._chd, and
		// thisJob in their ._ob, not in their ._prnt.
		// So we just iterate over them and trigger their cancellation and they'll
		// notify thisJob when their cancellation is done.
		for (let childLink = thisJob._tg; childLink != EMPTY_LINK; childLink = childLink.nA) {
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
	if (childLink == EMPTY_LINK) {
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
		childJob._prnt = EMPTY_LINK as Link<Job, Job>

		childLink = childLink.nA
	} while (childLink != EMPTY_LINK)

	thisJob._chd = EMPTY_LINK as Link<Job, Job>
}

function resumeJob(thisJob: Job, val?: unknown) {

	jobStack.push(thisJob)
	sys.runningJob = thisJob

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
		if (done) {
			thisJob.val = value
			endProtocol(thisJob)
		}
	}
	catch (e) {
		thisJob.val = new Err(e, thisJob._nm)
		endProtocol(thisJob, true)
	}
	finally {
		sys.runningJob = jobStack.pop()!
	}
}

function waitingChildren(thisJob: Job, tgVal: unknown) {
	let { _st, _tg } = thisJob

	if (_tg == EMPTY_LINK) {
		thisJob._st &= ~WAITING_CHILDREN
		execOnEnds(thisJob)
		return
	}

	thisJob._st |= WAITING_CHILDREN

	const childFailed = tgVal instanceof Err && !(tgVal instanceof ECancOK)

	if (childFailed) {
		addErrorToJobVal(thisJob, tgVal)
		endProtocol(thisJob, true)
	}
}

function addErrorToJobVal(thisJob: Job, err: Error) {
	const { val } = thisJob
	thisJob.val = val instanceof Err ? val.addError(err) : new Err(err, thisJob._nm)
}

function execOnEnds(thisJob: Job) {
	if (thisJob._ends == EMPTY_LINK) {
		settle(thisJob)
		return
	}

	thisJob._st |= WAITING_ONENDS

	const link = thisJob._ends
	const onEnd = link.a
	const type = link.b

	thisJob._ends = link.nA
	disposeLink(link)

	if (type == 1) {
		try {
			// eslint-disable-next-line no-var
			var retVal = (onEnd as SyncFn)()
		}
		catch (e) {
			retVal = wrapIfNotError(e)
		}
		if (retVal instanceof Error) {
			addErrorToJobVal(thisJob, retVal)
		}
		execOnEnds(thisJob)
	}
	else if (type == 2) {
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
		const job = new Job((onEnd as GenFn)(), onEnd.name)
		const observer = new CustomObserver((val) => {
			if (val instanceof Error) {
				addErrorToJobVal(thisJob, val)
			}
			execOnEnds(thisJob)
		})
		linkObAndTg(observer, job)
		resumeJob(job)
	}
}

class CustomObserver implements Ob {
	declare _tg: Link<Ob, Tg>
	constructor(private onTgDone: (val: unknown) => void) {}
	_onTgDone(val: unknown) {
		this.onTgDone(val)
	}
	_addTg() {}
	_rmTg() {}
}

function wrapIfNotError(x: unknown): Error {
	return x instanceof Error ? x :
		JSError("ThrownUnknownError", "Thrown value is not of type Error", x)
}

function settle(thisJob: Job) {
	const { _st, val } = thisJob

	if (_st & CANCELLING && !(val instanceof Err)) {
		thisJob.val = new ECancOK(thisJob._nm)
	}

	const parentLink = thisJob._prnt
	if (parentLink != EMPTY_LINK) {
		thisJob._prnt = EMPTY_LINK as Link<Job, Job>
		removeLinkFromLL(parentLink.a, "_chd", parentLink)
		disposeLink(parentLink)
	}

	// Notify observers
	for (let link = thisJob._ob; link != EMPTY_LINK; link = link.nA) {
		const ob = link.a
		unlinkObAndTg(link)
		ob._onTgDone(val)
	}

	thisJob._st = DONE
}


const jobIterator = {
	next() {
		let callerJob = sys.runningJob
		const { _st: thisJobSt, val } = self
		if (thisJobSt & DONE) {
			const callerJobSt = callerJob._st
			if (
				(callerJobSt & PARKED_JOB) && !(thisJobSt & DONE_OK) ||
				(callerJobSt & PARKED_JOB_CANCEL) && !(thisJobSt & DONE_ERR)
			) {
				callerJob.val = new Err(val, callerJob._nm)
				endProtocol(callerJob, true)
				iterRes.done = false
			}
			else {
				iterRes.done = true
				iterRes.value = val
			}
		}
		else {
			linkObAndTg(callerJob, self)
			iterRes.done = false
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



//* ************************  User API  ************************************ *//

type RibuGenFn<Ret = unknown, Args extends unknown[] = unknown[]> =
	(...args: Args) => Gen<Ret>

export type NotErrs<Ret> = Exclude<Ret, Error>

export function go<Args extends unknown[], Ret>(genFn: RibuGenFn<Ret, Args>, ...args: Args) {
	const gen = genFn(...args)
	const job = new Job<NotErrs<Ret>, Ret | ECancOK | Err>(gen, genFn.name, sys.runningJob)
	resumeJob(job)
	return job
}

export function me(): Job {
	return sys.runningJob
}

export function onEnd(newOnEnd: OnEnd) {
	addOnEnd(sys.runningJob, newOnEnd)
}

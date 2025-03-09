import { sys, type Link, EMPTY, disposeLink, freshLink, EMPTY_LINK, Tg, Ob } from "./shared.ts"
import { Err, ECancOK } from "./errors.ts"

// todo: sleep

/* ***********************  Lexicon  ******************************************

tg: Target
	- (potentially) blocks Observer and unblocks/calls-back with data/result.
	- Job, Chan, Sleep, Select, etc.

ob: Observer
	- Waits for a Target to call back with data/result.
	- Has references to observing targets so it can remove itself from them
		if cancelled.
	- Job, Select, etc.

LL: Linked List

EL: Empty Link

*/



/* ***************  Connect Observers <-> Targets via LLs  *********************

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

function linkJobs<Ob, Tg>(ob: Ob, ob_K: keyof Ob, tg: Tg, tg_K: keyof Tg) {
	const link = freshLink(ob, tg)
	addLinkToLLAsHead(tg, tg_K, link)
	addLinkToLLAsHead(ob, ob_K, link)
}

function unlinkJobs<Ob, Tg>(link: Link<Ob, Tg>, ob: Ob, ob_K: keyof Ob, tg: Tg, tg_K: keyof Tg) {
	removeLinkFromLL(tg, tg_K, link)
	removeLinkFromLL(ob, ob_K, link)
	disposeLink(link)
}



//* *********************  System variables  ******************************* *//

// todo: change stack to LL
let jobStack: Array<Job> = []
let self!: Job



//* ************************  Job Class  *********************************** *//

type OnEnd = () => unknown
type AsyncOnEnd =	RibuGenFn | (() => Promise<unknown>)

// asyncOnEnds optimization: separate sync and async onEnds into different
// workflows, since async are much expensive to process (need to setup exec +
// wait resources). Also, since expectation is that async onEnds are much rarer
// than sync onEnds, are placed in a Map to reduce memory of Job.
// Map.get() isn't much slower than job._asyncOnEnds.
const asyncOnEnds = new Map<Job, Link<AsyncOnEnd, undefined>>()


type Gen<Ret = unknown> =
	Generator<unknown, Ret, unknown>


/* Job continue/fail semantics

	- const res = yield* job.err   // res is All
		set flag PARKED_CONTINUE

	- const res = yield* job    // caller fails if all ::Errors
		set flag PARKED_JOB

	- const res = yield* job.cancelErr()    // res is All
		set flag PARKED_CONTINUE

	- yield* job.cancel()    // caller resumes at EcancOK even though it is ::Error
		set flag PARKED_JOB_CANCEL

	- const yield* cancel(jobs)  // caller resumes at EcancOK even though it is ::Error
		set flag PARKED_JOB_CANCEL
*/

type State = number

export const PARKED_CONTINUE = 1 << 0
export const PARKED_JOB = 1 << 1
export const PARKED_JOB_CANCEL = 1 << 2
export const PARKED_SLEEP = 1 << 3
export const CANCELLING = 1 << 4
export const WAITING_CHILDREN = 1 << 5
export const WAITING_ASYNC_ONENDS = 1 << 6
export const DONE = 1 << 7

export const PARKED = PARKED_CONTINUE | PARKED_JOB | PARKED_JOB_CANCEL | PARKED_SLEEP


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
 *  val = inbox/outbox for values like ch.put/rec, the final result of the job...
 *  _onTgDone = onTargetDone
 * 	Target calls this to notify job with data/result.
 */
export class Job<NotErrs = unknown, All = unknown> implements Ob, Tg {

	_gn: Gen
	_nm: string
	_st = 100 as State
	// todo: change types below bc maybe I'm not observing only Jobs for example
	_tg = EMPTY_LINK as Link<Ob, Tg>
	_ob = EMPTY_LINK as Link<Ob, Tg>
	_chd = EMPTY_LINK as Link<Job, Job>
	_prnt = EMPTY_LINK as Link<Job, Job>
	_ends = EMPTY_LINK as Link<OnEnd, undefined>
	val = EMPTY as NotErrs | All

	constructor(gen: Gen, genFnName: string, parent?: Job) {
		this._gn = gen
		this._nm = genFnName
		if (parent) {
			addJobAsChildOfParentJob(parent, this)
		}
	}

	_onTgDone(val: unknown) {
		const { _st, _tg } = this

		if (_st & PARKED_CONTINUE) {
			resumeJob(this, val)
			return
		}
		if (val instanceof Error) {
			if (_st & PARKED_JOB || (_st & PARKED_JOB_CANCEL && !(val instanceof ECancOK))) {
				this.val = new Err(val, this._nm) as NotErrs
				cancelJob(this)
				return
			}
		}
		if (_st & WAITING_CHILDREN) {
			waitingChildren(this, val)
			return
		}
		if (_st & WAITING_ASYNC_ONENDS) {
			waitingOnEnds(this, val)
			return
		}
	}

	_addTg(link: Link<Ob, Tg>) {
		addLinkToLLAsHead(this, "_tg", link)
	}

	_rmTg(link: Link<Ob, Tg>) {
		removeLinkFromLL(this, "_tg", link)
	}

	_rmOb(link: Link<Ob, Tg>) {
		removeLinkFromLL(this, "_ob", link)
	}

	get err() {
		// todo implement
		return jobIterable as Iterable<All>
	}

	/* To handle cancel errors manually, use:
		job.cancel()
		const res = yield* job.err
	*/
	cancel() {
		sys.runningJob._st |= PARKED_JOB_CANCEL
		cancelJob(this)
		return jobIterable as Iterable<undefined>
	}

	[Symbol.iterator]() {
		const callerJob = sys.runningJob


		return iter as Iter<NotErrs>
	}

	// todo maybe simplify this
	then(thenOK: (value: NotErrs) => NotErrs, thenErr: (reason: unknown) => Promise<never>): Promise<NotErrs> {
		const self = this
		return new Promise<NotErrs>((res, rej) => {

			const promObserver = {
				_onTgDone(val: unknown) {
					void (val instanceof Error) ? rej(val) : res(val as NotErrs)
				},
				_tg: EMPTY_LINK as Link<Ob, Job>,
				_addTg(tg: Tg, link: Link<Ob, Tg>) {},
				_rmTg(link: Link<Ob, Tg>) {},
			}

			// self._addOb(promObserver, freshLink(promObserver, self))

		}).then(thenOK, thenErr)
	}
}

function checkCallerJobStateToFailOrContinue(thisJob: Job) {
	const { _st } = thisJob
	if (_st & PARKED_CONTINUE) {
		resumeJob(thisJob)
		return
	}
}

function cancelJob(thisJob: Job) {
	const { _st } = thisJob
	if (_st & CANCELLING) {
		return
	}

	thisJob._st &= ~PARKED  // remove all PARKED related flags
	thisJob._st |= CANCELLING  // add CANCELLING flag

	if (_st & WAITING_CHILDREN) {
		// At WAITING_CHILDREN state, children are in ._tg, not in ._chd, and
		// thisJob in their ._ob, not in their ._prnt.
		// So we just iterate over them and trigger their cancellation and they'll
		// notify thisJob when their cancellation is done.
		let childLink = thisJob._tg
		do {
			cancelJob(childLink.b as Job)
			childLink = childLink.nA
		} while (childLink != EMPTY_LINK)

		return
	}


	// No check if (_st & WAITING_ONENDS) because there's nothing to do but wait
	// for onEnds to finish (there would be no children to cancel).


	// Unsubscribe from the single target blocking this job.
	const targetLink = thisJob._tg
	targetLink.b._rmOb(targetLink)
	disposeLink(targetLink)
	thisJob._tg = EMPTY_LINK as Link<Ob, Tg>

	// Cancel and observe all children for their cancellation result.
	observeChildren(thisJob, true)
	thisJob._st |= WAITING_CHILDREN
}

function observeChildren(thisJob: Job, cancelChilds = false) {
	let childLink = thisJob._chd
	do {
		let childJob = childLink.b

		if (cancelChilds) {
			cancelJob(childJob)
		}

		// We can reuse the Links of ._prnt/._chdn relationship and add them in
		// child observers LL since now that parent needs a result from child.
		// Only need to add childs as targets of parent, so childs can remove
		// themselves as targets of parent like settling any other way.
		insertAsTargetToJob(thisJob, childJob, childLink)

		// This so when child settles, it will not mess we the links we are
		// reusing. See removeJobFromParent()
		childJob._prnt = EMPTY_LINK as Link<Job, Job>

		childLink = childLink.nA

	} while (childLink != EMPTY_LINK)

	thisJob._chd = EMPTY_LINK as Link<Job, Job>
}

function addJobAsChildOfParentJob(parent: Job, childJob: Job) {
	// as if parent is observer and child is target (convenient in cancelJob())
	const link = freshLink(parent, childJob)
	addLinkToLLAsHead(parent, "_chd", link)

}

// check this function
function removeJobFromParent(job: Job) {
	let link = job._prnt
	if (link != EMPTY_LINK) {
		link.pA.nA = link.nA
		link.nA.pA = link.pA

		// if link is head of LL, update the head of the LL we're removing from
		if (link.pA == EMPTY_LINK) {
			link.a._chd = link.nA
		}

		job._prnt = EMPTY_LINK as Link<Job, Job>
		disposeLink(link)
	}
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
		cancelJob(thisJob)
	}
	finally {
		sys.runningJob = jobStack.pop()!
	}
}

function endProtocol(thisJob: Job) {
	thisJob._st = 0

	if (thisJob._chd != EMPTY_LINK) {
		thisJob._st |= WAITING_CHILDREN
		observeChildren(thisJob)
		return
	}

	if (thisJob._ends != EMPTY_LINK) {
		thisJob._st |= WAITING_ASYNC_ONENDS
		execOnEnds(thisJob)
		return
	}

	settle(thisJob)
}

function settle(thisJob: Job) {
	const { _st, val } = thisJob
	removeJobFromParent(thisJob)

	// Notify observers
	for (let link = thisJob._ob; link != EMPTY_LINK; link = link.nA) {
		const ob = link.a
		unlinkComponents(link, ob, thisJob)
		ob._onTgDone(val)
	}

	thisJob._st = DONE
}


function waitingChildren(thisJob: Job, tgVal: unknown) {
	let { _st, _tg, val } = thisJob

	const childFailed = tgVal instanceof Error && !(tgVal instanceof ECancOK)

	if (childFailed) {
		addErrorToJobVal(thisJob, tgVal)
		cancelJob(thisJob)
	}

	if (_tg == EMPTY_LINK) {
		transitionStates(thisJob, WAITING_CHILDREN, WAITING_ASYNC_ONENDS)
		execOnEnds(thisJob)
	}
}

function addErrorToJobVal(thisJob: Job, err: Error) {
	const { val } = thisJob
	if (val instanceof Err) {
		val.addError(err)
	}
	else {
		thisJob.val = new Err(err, thisJob._nm)
	}
}

function execOnEnds(thisJob: Job) {
	let { _ends: link} = thisJob

	while (link != EMPTY_LINK) {
		const onEnd = link.a

		try {
			// eslint-disable-next-line no-var
			var retVal = onEnd()
		}
		catch (e) {
			retVal = wrapIfNotError(e)
		}

		if (retVal instanceof Error) {
			addErrorToJobVal(thisJob, retVal)
		}

		link = link.nA
		disposeLink(link)
	}

	thisJob._ends = EMPTY_LINK as Link<OnEnd, Job>
}

function execAsyncOnEnds(thisJob: Job) {
	let link = asyncOnEnds.get(thisJob)

	if (!link) {
		return
	}

	while (link != EMPTY_LINK) {
		const onEnd = link.a
		const x = onEnd()
		if ("then" in x) {
			const promObserver = new PromiseAsOb(x)
			x.then(() => onDone(), e => onDone(wrapIfNotError(e)))
		}
		else {
			const job = new Job(x, onEnd.name)
			resumeJob(job)
			insertAsObserverToJob(thisJob, job, freshLink(thisJob, job))
		}

		link = link.nA
		disposeLink(link)
	}

	asyncOnEnds.delete(thisJob)
}

function linkPromiseAsJobTarget(prom: Promise<unknown>, thisJob: Job) {

	const dummyObs: Ob = {
		_tg: EMPTY_LINK as Link<Ob, Job>,
		_onTgDone(val: unknown) {},
		_rmTg(link: Link<Ob, Job>) {}
	}

	insertAsTargetToJob(dummyObs, thisJob, freshLink(dummyObs, thisJob))

	// When promise completes, notify the parent job and remove from targets
	prom.then(
		(val) => {
			thisJob._onTgDone(val)
			// Find and remove this observer from parent's targets
			for (let link = dummyObs._tg; link != EMPTY_LINK; link = link.nA) {
				if (link.b === thisJob) {
					dummyObs._rmTg(link)
					break
				}
			}
		},
		(err) => {
			const wrappedErr = wrapIfNotError(err)
			thisJob._onTgDone(wrappedErr)
			// Find and remove this observer from parent's targets
			for (let link = dummyObs._tg; link != EMPTY_LINK; link = link.nA) {
				if (link.b === thisJob) {
					dummyObs._rmTg(link)
					break
				}
			}
		}
	)

	return handlePromiseAsTarget(prom, thisJob)

}

function waitingOnEnds(thisJob: Job, tgVal: unknown) {

}

function transitionStates(thisJob: Job, from: State, to: State) {
	thisJob._st &= ~from
	thisJob._st |= to
}





//* ************************  The Iterator  ******************************** *//

export let iterRes = {
	done: false,
	value: 0 as unknown,
}

export type Iter<V> = Iterator<unknown, V>
export const iter = {
	next() {
		return iterRes
	}
}

export type Iterable<V> = {
	[Symbol.iterator]: () => Iterator<never, V>
}


const jobIterable = {
	[Symbol.iterator]() {
		// what to do here?
		return iter
	}
}



//* ************************  User API  ************************************ *//

type RibuGenFn<Ret = unknown, Args extends unknown[] = unknown[]> =
	(...args: Args) => Gen<Ret>

export type NotErrs<Ret> = Exclude<Ret, Error>
type OnlyErrs<Ret> = Extract<Ret, Error>

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
	let job = sys.runningJob
	const { _ends: oldHead } = job
	let newLink = freshLink(newOnEnd, undefined)
	job._ends = newLink
	newLink.nA = oldHead
}

export function asyncOnEnd(newOnEnd: AsyncOnEnd) {
	const job = sys.runningJob
	const oldHead = asyncOnEnds.get(job)
	let newLink = freshLink(newOnEnd, undefined)
	newLink.nA = oldHead || EMPTY_LINK as Link<AsyncOnEnd, undefined>
	asyncOnEnds.set(job, newLink)
}





// const res = yield* job
// ECancOK is not in res

// const res = yield* job.cancel()
// res in undefined

// const res = yield* job.err
// Ret | ECancOK | Err

// const res = yield* job.cancel().err
// Errs without ECancOK




//* **********  Utils  ********** *//

function wrapIfNotError(x: unknown): Error {
	return x instanceof Error ? x : {
		name: "ThrownUnknownError",
		message: "Thrown value is not of type Error",
		cause: x
	}
}

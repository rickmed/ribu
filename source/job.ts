import { sys, type Link, EMPTY, disposeLink, freshLink, Ob, EMPTY_LINK, ObBase } from "./shared.ts"
import { ETimedOut, Err, ECancOK } from "./errors.ts"

// todo, sleep mechanism

/* todo: Ob interface:
	what are observers in ribu?
	job, channel, select, sleeper
*/


/* *** System variables *** */

// change stack to LL
let jobStack: Array<Job> = []
let self!: Job


//* **********  Job Class  ********** *//

export const PARKED_CONTINUE = 1 << 0
export const PARKED_JOB = 1 << 1
export const PARKED_JOB_CANCEL = 1 << 2
export const PARKED_SLEEP = 1 << 3
export const CANCELLED = 1 << 4
export const WAITING_CHILDREN = 1 << 5
export const WAITING_ONENDS = 1 << 6
export const DONE = 1 << 7

type State = number

const asyncOnEnds = new Map<Job, Link<AsyncOnEnd>>()

/*
 * gn = generator
 * nm = generator function name
 * st = state
 * ob = observers LL Head
 *   Objects waiting the result of this job.
 * tg = targets LL Head
 *   Objects this job is observing for result:
 *   - A single item if genFn is blocked at yield*
 *   - Several, for example:
 *     - If waiting for children (finish normally or when done their cancellation)
 *     - Async onEnds to finish.
 * val = inbox/outbox for values like ch.put/rec and others.
 * chd = children jobs (LL Head)
 * prnt = parent job
 *   There's always one parent, so can treat it as a single link, instead of a LL.
 * ends = onEnds LL Head
 */
export class Job<Ret = unknown, Errs = unknown> extends ObBase {

	_gn: Gen
	nm: string
	_st = 100 as State
	// todo: change types below bc maybe I'm not observing only Jobs for example
	_ob = EMPTY_LINK as Link<Ob, Job>
	_chd = EMPTY_LINK as Link<Job, Job>
	_prnt = EMPTY_LINK as Link<Job, Job>
	_ends = EMPTY_LINK as Link<OnEnd, Job>
	val = EMPTY as Ret | Errs

	constructor(gen: Gen, genFnName: string, parent?: Job) {
		super()
		this._gn = gen
		this.nm = genFnName
		if (parent) {
			addJobAsChild(this, parent)
		}
	}

	rmTg(link: Link<Ob, Job>) {
		link.pB.nB = link.nB
		link.nB.pB = link.pB
		if (link.pB == EMPTY_LINK) {
			this._tg = link.nB
		}
		disposeLink(link)
	}

	onEnd(newV: OnEnd) {
		let { _ends: _onEnds } = this
		if (!_onEnds) {
			this._ends = newV
		}
		else if (Array.isArray(_onEnds)) {
			_onEnds.push(newV)
		}
		else {
			this._ends = [_onEnds, newV]
		}
	}

	get err() {
		self = this
		return TheJobIterable as Iterable<typeof this.val>
	}


	then(thenOK: (value: Ret) => Ret, thenErr: (reason: unknown) => Promise<never>): Promise<Ret> {
		const self = this
		// todo maybe simplify this
		return new Promise<Ret>((res, rej) => {

			const promObserver = {
				_onTgDone(val: unknown, targetJobFailed?: boolean, valIsECancOK?: boolean) {
					void ((targetJobFailed || valIsECancOK) ?
						rej(val as Error) :
						res(val as Ret))
				},
				_tg: EMPTY_LINK as Link<Ob, Job>,
				rmTg(link: Link<Ob, Job>) {
					link.pB.nB = link.nB
					link.nB.pB = link.pB
					if (link.pB == EMPTY_LINK) {
						this._tg = link.nB
					}
				}
			}

			insertAsObserverToJob(promObserver, this, freshLink(promObserver, self))

		}).then(thenOK, thenErr)
	}

	// problem is that target could have ended with ECancOK but need
	// to check here if i need to fail if I'm PARKED_END_IF_FAIL
	// (instanceof is expensive) and this is called by channels and so on
	// also, need to know if I was cancelled originally i think
	/*
	 * is called by other Jobs and Channels
	 * When waiting for children when they are don
	 *
	 */

	// channel/select calls me with val and PARKED_CONTINUE
	// jobSelect calls me with job and PARKED_CONTINUE
	// job calls me with with val (can fail) PARKED_END_IF_FAIL | PARKED_CONTINUE

	/* EcancOK semantics

	- const res = yield* job    // caller fails if all ::Errors
		set flag PARKED_JOB

	- const res = yield* job.err
		set flag PARKED_CONTINUE

	- yield* job.cancel()    // caller resumes at EcancOK even though it is ::Error
		set flag PARKED_JOB_CANCEL

	- const yield* cancel(jobs)  // caller resumes at EcancOK even though it is ::Error
		set flag PARKED_JOB_CANCEL
*/


	_onTgDone(val: unknown) {
		const { _st, _tg } = this

		if (_st & PARKED_CONTINUE) {
			resumeJob(this, val)
			return
		}
		if (val instanceof Error) {
			if (_st & PARKED_JOB || (_st & PARKED_JOB_CANCEL && !(val instanceof ECancOK))) {
				this.val = new Err(val, this.nm) as Ret
				cancelJob(this)
				return
			}
		}
		if (_st & WAITING_CHILDREN) {
			waitingChildren(this, val)
			return
		}
		if (_st & WAITING_ONENDS) {
			waitingOnEnds(this)
			return
		}
	}



	[Symbol.iterator]() {

		return iterator as Iter<V>
	}

	cancel() {
		const { _st } = this
		if (_st & DONE) {
			// todo: caller should fail if result is other than ECancOK
			iterRes.done = true
			iterRes.value = this.val
		}
		else {
			cancelJob(this)
			const { runningJob } = sys
			insertAsObserverToJob(runningJob, this, freshLink(runningJob, this))
			iterRes.done = false
		}
		return TheJobIterable as Iterable<typeof this.val>
	}
}

function cancelJob(thisJob: Job) {
	const { _st } = thisJob
	if (_st & CANCELLED) {
		return
	}

	transitionStates(thisJob, PARKED, CANCELLED)

	if (_st & WAITING_CHILDREN) {
		// Since children are already in .obH/.tgH (not .chdn/.prnt)
		let childLink = thisJob._tg
		do {
			let childJob = childLink.b
			cancelJob(childJob)
			childLink = childLink.nA
		} while (childLink != EMPTY_LINK)

		return
	}

	// No check if (_st & WAITING_ONENDS) because there's nothing to do but wait
	// for onEnds to finish (childs are already settled).

	// Unsubscribe from whatever is at yield*
	removeJobFromTargets(thisJob)

	// Cancel and observe all children
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

function addJobAsChild(childJob: Job, parent: Job) {
	// as if parent is observer and child is target (convenient in cancelJob())
	let link = freshLink<Ob, Job>(parent, childJob)

	childJob._prnt = link

	let oldChdnHead = parent._chd
	parent._chd = link
	link.nA = oldChdnHead
	oldChdnHead.pA = link
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
		thisJob.val = new Err(e, thisJob.nm)
		cancelJob(thisJob)
	}
	finally {
		sys.runningJob = jobStack.pop()!
	}
}


/*
.cancel()
	unsub from targets (._tgH)
	if (childs), loop childs and call cancelJob(), move to state = waitingChilds

	this could just mutate Links in .chids LL to subscribe to childs' observers
		and move to job._tgH = EMPTY_LINK

	what is the link in ._chdn LL?
	L = {
		a: childJob,
		nA: nextChildJobLink,
		pA: nextChildJobLink,
	}

	this same link is in child._parent
		so when child is done, it can remove O(1) itself from parent._chdn LL



jobReturned
	if (childs), exec waitChlds and move to
	call/wait onEnds
jobThrew:
	cancel childs, exec onEnds
jobCancelled:
	waiting childs
		ctx can be same if (.childs), ie, childs in LL
	waiting (async) onEnds
		ctx can be same if (.onEnds), ie, childs in LL

endProtocol:
	wait_childs, then exec onEnds  (or settle() direcly)
*/


function endProtocol(thisJob: Job) {
	thisJob._st = 0

	if (thisJob._chd != EMPTY_LINK) {
		thisJob._st |= WAITING_CHILDREN
		observeChildren(thisJob)
		return
	}

	if (thisJob._ends != EMPTY_LINK) {
		thisJob._st |= WAITING_ONENDS
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
		ob._onTgDone(val)
		ob.rmTg(link)
	}

	thisJob._st = DONE
}

// todo: I don't think this works if I'm BLOCKED on a channel or sleep
function removeJobFromTargets(thisJob: Job) {
	for (let targetLink = thisJob._tg; targetLink != EMPTY_LINK; targetLink = targetLink.nA) {
		// remove from observers in target
		targetLink.nA.pA = targetLink.pA
		targetLink.pA.nA = targetLink.nA

		targetLink = targetLink.nA
		disposeLink(targetLink)
	}

	thisJob._tg = EMPTY_LINK as Link<Ob, Job>
}

function removeFromChanPutQueue(thisJob: Job) {
	let link = thisJob._tg


}

// if I failed and observer is job... ?
function notifyObservers(thisJob: Job) {
	// loop over ._obH linked list like removeFromTargets
	let obsLink = thisJob._ob
	while (obsLink) {

		// remove as target from observer's LL
		obsLink.nA.pA = obsLink.pA
		obsLink.pA.nA = obsLink.nA

		obsLink = obsLink.nB

		// can check fast if I fail if _stateCtx is not undefined, has array errors,
		// if genFn returns ::Error?
		//  (need to reset _stateCtx after out of PARKED)
		// if .val == CANCELLED and _stateCtx is undefined (not have errors), then my result is ECancOK

		const obs = obsLink.a
		obs._onTgDone(self.val, thisJob._failed)
		disposeLink(obsLink)
	}
}


function linkJobs(observer: Job, target: Job) {
	let link = freshLink(observer, target)
	insertAsObserverToJob(observer, target, link)
	insertAsTargetToJob(observer, target, link)
}

function insertAsObserverToJob(observer: Ob, target: Job, link: Link<Ob, Job>) {
	// insert as head of observers in target
	let observersOldHead = target._ob
	target._ob = link
	link.nA = observersOldHead
	observersOldHead.pA = link
}

function insertAsTargetToJob(observer: Ob, target: Job, link: Link<Ob, Job>) {
	// insert as head of targets in observer
	let targetsOldHead = observer._tg
	if (targetsOldHead != EMPTY_LINK) {
		link.nB = targetsOldHead
		targetsOldHead.pB = link
	}
}


/* Job State Handlers */

function waitingChildren(thisJob: Job, tgVal: unknown) {
	let { _st, _tg, val } = thisJob

	const childFailed = tgVal instanceof Error && !(tgVal instanceof ECancOK)

	if (childFailed) {
		addErrorToJobVal(thisJob, tgVal)
		cancelJob(thisJob)
	}

	if (_tg == EMPTY_LINK) {
		transitionStates(thisJob, WAITING_CHILDREN, WAITING_ONENDS)
		execOnEnds(thisJob)
	}
}

function addErrorToJobVal(thisJob: Job, err: Error) {
	const { val } = thisJob
	if (val instanceof Err) {
		val.addError(err)
	}
	else {
		thisJob.val = new Err(err, thisJob.nm)
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
			retVal = e
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
		const thing = onEnd()
		if ("then" in thing) {
			const promObserver = new PromiseAsOb(thing)
			thing.then(() => onDone(), e => onDone(wrapIfNotError(e)))
		}
		else {
			const job = new Job(thing, onEnd.name)
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
			rmTg(link: Link<Ob, Job>) {}
		}

		insertAsTargetToJob(dummyObs, thisJob, freshLink(dummyObs, thisJob))

		// When promise completes, notify the parent job and remove from targets
		prom.then(
			(val) => {
				thisJob._onTgDone(val)
				// Find and remove this observer from parent's targets
				for (let link = dummyObs._tg; link != EMPTY_LINK; link = link.nA) {
					if (link.b === thisJob) {
						dummyObs.rmTg(link)
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
						dummyObs.rmTg(link)
						break
					}
				}
			}
		)

		return dummyObs
	}

	return handlePromiseAsTarget(prom, thisJob)
}

function waitingOnEnds(thisJob: Job, tgVal: unknown) {
	// todo
}

function transitionStates(thisJob: Job, from: State, to: State) {
	thisJob._st &= ~from
	thisJob._st |= to
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


const TheJobIterable = {
	[Symbol.iterator]() {

		const callerJob = sys.runningJob

		if (self._st &= DONE) {
			if (self._failed) {
				onTargetJobFailed(callerJob, self.val)
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


//* **********  User API  ********** *//

export function onEnd(x: OnEnd) {
	sys.runningJob.onEnd(x)
}

export function me(): Job {
	return sys.runningJob
}

export function go<Args extends unknown[], Ret>(genFn: RibuGenFn<Ret, Args>, ...args: Args) {
	const gen = genFn(...args)
	const job = new Job<NotErrs<Ret>, OnlyErrs<Ret> | ECancOK | ETimedOut | Err>(gen, genFn.name, sys.runningJob)
	resumeJob(job)
	return job
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

type OnEnd = () => unknown
type AsyncOnEnd =	RibuGenFn | (() => Promise<unknown>)






/** Ports
 // ports<_P extends Ports>(ports: _P) {
 // 	const prcApi_m = ports as WithCancel<_P>
 // 	// Since a new object is passed anyway, reuse the object for the api
 // 	prcApi_m.cancel = this.cancel.bind(this)
 // 	return prcApi_m
 // }
 *
 */

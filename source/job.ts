import { sys, type Link, Linkable, EMPTY, disposeLink, freshLink, LL, ObsLL, NtsLL, Observer, EMPTY_LINK } from "./shared.ts"
import { Chan } from "./channel.ts"
import { Timeout } from "./timers.ts"
import { ETimedOut, Err, isRibuE, ECancOK } from "./errors.ts"



/* *** System variables *** */

// change to LL using Node
let jobStack: Array<Job> = []
let self!: Job


//* **********  Job Class  ********** *//

export enum State {
	PARKED_END_IF_FAIL = 1,
	PARKED_CONTINUE,
	PARKED_SLEEP,
	WAITING_CHILDREN,
	WAITING_ONENDS,
	CANCELLING_WAITING_CHILDREN,
	CANCELLING_WAITING_ONENDS,
	DONE
}

export const {
	PARKED_END_IF_FAIL,
	PARKED_CONTINUE,
	PARKED_SLEEP,
	WAITING_CHILDREN,
	WAITING_ONENDS,
	CANCELLING_WAITING_CHILDREN,
	CANCELLING_WAITING_ONENDS,
	DONE
} = State

/*
 * st = state
 * stCtx = stateCtx
 * obH = observers
 *   Objects observing the result for this job to call back when done.
 * tgH = targets
 *   Objects this job is observing for result:
 *  - A single item if genFn is blocked at yield*
 *   - Several (internall mechanisms):
 *     - If waiting for children to call back (finish normally or end cancel)
 *     - Async onEnds to call back
 * val = inbox/outbox for values like ch.put/rec and others.
 * chdn = children jobs
 *   We use the .b spot in link to store the child Job
 * parent = parent job
 *   The same link is used in chdn
 */
export class Job<Ret = unknown, Errs = unknown> {

	_gen: Gen
	_name: string
	// init state is just a startup placeholder
	_st: State = PARKED_END_IF_FAIL
	_obH = EMPTY_LINK as Link<Observer, Job>
	_tgH = EMPTY_LINK as Link<Observer, Job>
	_chdn = EMPTY_LINK as Link<Observer, Job>
	_prnt = EMPTY_LINK
	_onEnds?: OnEnd | OnEnd[]  // todo: change to LL
	val = EMPTY as Ret | Errs  //  inbox/outbox

	constructor(gen: Gen, genFnName: string, parent?: Job) {
		this._gen = gen
		this._name = genFnName
		if (parent) {
			addJobAsChild(this, parent)
		}
	}

	#genFnReturned(yieldedVal: Ret | Errs) {
		const settleVal = this.val = yieldedVal
		if (isRibuE(settleVal)) {
			if (settleVal._fn === "") {
				settleVal._fn = this._name
			}
			this._endProtocol()
			return
		}
		if (settleVal instanceof Error) {
			this.val = new Err(settleVal, this._name) as Ret
			this._endProtocol()
			return
		}
		if (this._chdn?.size) {
			this.#waitChilds()
			return
		}
		this._endProtocol()
	}

	#waitChilds() {

		this._st = "WAITING_CHILDS"
		const childs = this._chdn
		const me = this

		let nChilds = childs.size
		let nChildsDone = 0

		for (let i = 0; i < nChilds; i++) {
			const job = childs.arr[i]
			if (job) {
				job._on(EV.JOB_DONE_WAITCHILDS, cb)
			}
		}

		function cb(childDone: Job) {
			++nChildsDone
			if (childDone._failed) {
				me._removeWaitChildsCBs()
				me.val = new Err(childDone.val, me._name) as Ret
				me._endProtocol()
				return
			}
			if (nChildsDone === nChilds) {
				me._endProtocol()
			}
		}

	}

	_removeWaitChildsCBs() {
		const cs = this._chdn
		const csL = cs.size
		for (let i = 0; i < csL; i++) {
			const job = cs.arr[i]
			if (job) {
				job._removeEvCBs(EV.JOB_DONE_WAITCHILDS)
			}
		}
	}

	_endProtocol(errors?: Error[]) {
		const { _sleepTO, _onEnds, _chdn: _childs } = this

		if (_sleepTO) {
			clearTimeout(_sleepTO)
		}

		if (!(_onEnds || (_childs && _childs.size > 0))) {
			this.#_settle()
			return
		}

		const me = this
		let nWaiting = 0
		let nDone = 0

		if (_childs) {
			nWaiting += _childs.size
			const { arr } = _childs
			const len = arr.length
			for (let i = 0; i < len; i++) {
				const childJob = arr[i]
				if (childJob) {
					childJob._endProtocol()
					childJob._onDone(onJobDone)
				}
			}
		}

		if (_onEnds) {
			if (Array.isArray(_onEnds)) {
				const len = _onEnds.length
				for (let i = len - 1; i >= 0; i--) {  // last set, first called.
					execOnEnd(_onEnds[i]!)
				}
			}
			else {
				execOnEnd(_onEnds)
			}
		}

		function execOnEnd(x: OnEnd): void {
			++nWaiting
			if (isGenFn(x)) {
				new Job(x(), x.name)._run()._onDone(onJobDone)
			}
			else if (x instanceof Function) {
				const ret = tryFn(x)
				if (isProm(ret)) {
					ret.then(() => onDone(), e => onDone(wrapIfNotError(e)))
					return
				}
				if (ret instanceof Job) {
					ret._onDone(onJobDone)
					return
				}
				onDone(ret instanceof Error ? ret : undefined)
			}
			else if (Symbol.dispose in x) {
				const disposeFn = x[Symbol.dispose].bind(x)
				tryFn(disposeFn)
			}
			else {
				x[Symbol.asyncDispose]().then(() => onDone(), e => onDone(wrapIfNotError(e)))
			}
		}

		function tryFn(fn: () => unknown) {
			try {
				return fn()
			}
			catch (e) {
				return e
			}
		}

		function onDone(err?: Error) {
			++nDone
			if (err) {
				if (!errors) {
					errors = []
				}
				errors.push(err)
			}
			if (nDone === nWaiting) {
				me.#_settle(errors)
			}
		}

		function onJobDone(j: Job) {
			onDone(j.val instanceof Error ? j.val : undefined)
		}
	}

	#_settle(errors?: Error[]) {
		if (this._st === "CANCELLING" && errors) {
			const eCancOK = this.val as ECancOK
			this.val = new Err(undefined, this._name, errors, eCancOK.message) as Ret
			this.#completeSettle()
			return
		}
		if (errors) {
			if (this.val instanceof Err) {
				this.val.errors = errors
			}
		}
		this.#completeSettle()
	}

	#completeSettle() {
		const finalVal = this.val
		if (finalVal instanceof Error && !(finalVal instanceof ECancOK)) {
			this._failed = true
		}
	}

	onEnd(newV: OnEnd) {
		let { _onEnds } = this
		if (!_onEnds) {
			this._onEnds = newV
		}
		else if (Array.isArray(_onEnds)) {
			_onEnds.push(newV)
		}
		else {
			this._onEnds = [_onEnds, newV]
		}
	}

	get failed(): boolean {
		return this._failed
	}

	get err() {
		self = this
		return TheJobIterable as Iterable<typeof this.val>
	}

	// todo: set this._gen = null, just in case
	settle(val: Ret | Errs) {
		if (this._st === "DONE") {
			return
		}
		this.#genFnReturned(val)
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
	- const res = yield* job    // caller fails
	- yield* job.cancel()    // caller resumes even though job result is ECancOK (::Error)
*/


	_onTgDone(val: unknown) {
		const { _st } = this
		if (_st == PARKED_END_IF_FAIL) {
			if (val instanceof ECancOK) {
				this.val = new Err(val, this._name) as Ret
				cancelJob(this)
				return
			}
			if (valIsECancOK) {
				this.val = new ECancOK() as Ret  // todo
				endProtocol(this)
				return
			}
			resumeJob(this, val)
			return
		}
		if (_st == PARKED_CONTINUE) {
			resumeJob(this, val)
			return
		}
		if (_st == WAITING_CHILDREN || _st == CANCELLING_WAITING_CHILDREN) {
			waitingChildren(this, val)
			return
		}
		if (_st == WAITING_ONENDS || _st == CANCELLING_WAITING_ONENDS) {
			waitingOnEnds(this)
			return
		}
	}

	[Symbol.iterator]() {

		return iterator as Iter<V>
	}

	/**
	 * Caller fails if result is other than ECancOK
	 */
	cancel() {
		const { _st } = this
		if (_st == DONE) {
			iterRes.done = true
			iterRes.value = this.val
		}
		else if (_st != CANCELLING_WAITING_CHILDREN && _st != CANCELLING_WAITING_ONENDS) {
			cancelJob(this)
			iterRes.done = false
		}
		return TheJobIterable as Iterable<typeof this.val>
	}
}


function addJobAsChild(job: Job, parent: Job) {
	// as if parent is observer and child is target (convenient for some cancellation parts)
	let link = freshLink<Observer, Job>(parent, job)

	job._prnt = link

	let oldChdnHead = parent._chdn
	parent._chdn = link
	link.nA = oldChdnHead
	oldChdnHead.pA = link
}

function removeJobFromParent(child: Job) {
	let link = child._prnt
	link.nA.pA = link.pA
	link.pA.nA = link.nA
	child._prnt = EMPTY_LINK
	disposeLink(link)
}


const CANCELLED = Symbol("canc")

function resumeJob(thisJob: Job, val?: unknown) {

	jobStack.push(thisJob)
	sys.runningJob = thisJob

	// Whatever function with yield* will replace these values to park/continue job.
	// These will considered by the js runtime when run is resumed from being
	// parked (or started), ie resumeJob() is called, because the runtime will
	// inmediately call the delegated iterator but this time the iterator will
	// return the values set here, ie, job will continue from yield* with val.
	iterRes.done = true
	iterRes.value = val

	try {
		// No values are passed into gen.next() because values inside the generator
		// function are received by the returned iteratorResult object
		const { done, value} = thisJob._gen.next()
		if (done) {
			thisJob.val = value
			endProtocol(thisJob)
		}
	}
	catch (e) {
		thisJob.val = new Err(e, thisJob._name)
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
jobThrew, jobCancelled
	waiting childs
		ctx can be same if (.childs), ie, childs in LL
	waiting (async) onEnds
		ctx can be same if (.onEnds), ie, childs in LL

*/

// endProtocol is wait_childs, then exec onEnds  (or settle() direcly)

function endProtocol(thisJob: Job) {
	const { _chdn, _onEnds } = thisJob
	if (_chdn != EMPTY_LINK) {
		waitForChildren(thisJob)
		return
	}

	if (_onEnds) {
		execOnEnds(thisJob)
		return
	}

	settle(thisJob)
}

function waitForChildren(thisJob: Job) {

	waitingChildren(thisJob)

}

function settle(thisJob: Job) {
	const { _st, val } = thisJob



	thisJob._st = DONE
	removeJobFromParent(thisJob)
}






function cancelJob(thisJob: Job) {
	// unsubscribe from whatever object job is BLOCKED
	thisJob.val = CANCELLED  // todo: ???
	if (thisJob._tgH !== EMPTY_LINK) {
		removeJobFromTargets(thisJob)
	}

	// cancel all childs iterating over childs LL
	let childLink = thisJob._chdn
	while (childLink != EMPTY_LINK) {
		const childJob = childLink.b
		cancelJob(childJob)
		// reuse link between parent as Observer and Child as target to
		// add in observers LL of child (to call back when child ends cancellation)
		insertAsObserverToJob(thisJob, childJob, childLink)
		childLink = childLink.nA
	}

	// i don't think this will work bc when I iterate over observers LL to notify,
	// how do I remove from target ll?
	// I could point prev and next to each other, but what if I'm the head?
	// then I need to update owner._tgH = next Link

	// need to add me as observer to childs
	thisJob._st = CANCELLING_WAITING_CHILDREN
	waitingChildren(thisJob)
}

function removeJobFromTargets(thisJob: Job) {
	let targetLink = thisJob._tgH

	// all removeFromTargets calls are protected by thisJob._tgH !== EMPTY_LINK
	// so can start loop without checking
	do {
		// remove from observers in target
		targetLink.nA.pA = targetLink.pA
		targetLink.pA.nA = targetLink.nA

		targetLink = targetLink.nA
		disposeLink(targetLink)

	} while (targetLink != EMPTY_LINK)

	thisJob._tgH = EMPTY_LINK as Link<Observer, Job>
}

function removeFromChanPutQueue(thisJob: Job) {
	let link = thisJob._tgH


}

// if I failed and observer is job... ?
function notifyObservers(thisJob: Job) {
	// loop over ._obH linked list like removeFromTargets
	let obsLink = thisJob._obH
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

	// insert as head of targets in observer
	let targetsOldHead = observer._tgH
	if (targetsOldHead) {
		link.nB = targetsOldHead
		targetsOldHead.pB = link
	}

}

function insertAsObserverToJob(observer: Observer, target: Job, link: Link<Observer, Job>) {
	// insert as head of observers in target
	let observersOldHead = target._obH
	target._obH = link
	link.nA = observersOldHead
	observersOldHead.pA = link
}



/* Job Possible Input Events */


function jobReturned(thisJob: Job, val: unknown) {
	// go to waiting childs
}

function jobThrew(thisJob: Job, val: unknown) {
}

/* Job State Handlers */

function waitingChildren(thisJob: Job, val: unknown) {
	const { _chdn } = thisJob
	// remove a child from _chdn LL

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

		if (self._st === DONE) {
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

type OnEnd =
	(() => unknown) | (() => Promise<unknown>) |
	Disposable | AsyncDisposable | RibuGenFn

/** Ports
 // ports<_P extends Ports>(ports: _P) {
 // 	const prcApi_m = ports as WithCancel<_P>
 // 	// Since a new object is passed anyway, reuse the object for the api
 // 	prcApi_m.cancel = this.cancel.bind(this)
 // 	return prcApi_m
 // }
 *
 */

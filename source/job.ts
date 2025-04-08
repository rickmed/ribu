import {
	sys,
	type Link,
	VOID_LINK,
	type VoidLink,
	VOID_OBJ,
	type VoidObj,
	freshLink,
	disposeLink,
	iterRes,
	SYS_ITERATOR,
	type SysIterator,
	SYS_ITERABLE,
	type SysIterable,
	ensurePreviousYieldAndSetCallerJobNextSt,
} from "./system.js"
import { type Er, RibuErr, E_CANC_OK, ECancOk, _Err } from "./errors.js"
import { Chan, PutterLink, ReceiverLink } from "./channel.js"

// todo: implement "unsub() to have something like trio's moveOnAfter()
// 	for jobs and job-helpers

// todo: implement using/dispose() for jobs
// 	check when a function is called and obj is in pool, throw (with flags)
// 	evaluate for channels as well

// todo: evaluate passing me().cancel to cancel() (maybe use same internal function
// 	as pool's cancel)

// todo: remove Job stack from sys, put it here and use LL
// todo: clean-up documentation
// "whenever there's a iterRes.done = false, it means block the job"
// maybe forever if, eg, job failed.

// todo, consider implementing yield* job.map_err(...)


//* **********************  Job Class  ************************************* *//

const DUMMY_GEN = (function* () {})()
let self: _Job

export type RibuGen<Ret = unknown> =
	Generator<unknown, Ret, unknown>

type RibuGenFn<Ret = unknown, Args extends unknown[] = unknown[]> =
	(...args: Args) => RibuGen<Ret>

type JobsLink = Link<_Job, _Job>
type JobChanLink = Link<_Job, Chan>
type WaitingChdLink = JobsLink
type TgLink = JobChanLink | WaitingChdLink | PutterLink | ReceiverLink

type OnJobDone<T = _Job> = (val: unknown, tg: _Job, bPosInLink: T) => void
type CallbackLink<T = _Job> = Link<OnJobDone<T>, T>
type ObserverLink<T = _Job> = JobsLink | CallbackLink<T>

type SyncFn = () => unknown
type AsyncFn = () => Promise<unknown>
type OnEnd = SyncFn | AsyncFn | RibuGenFn
type OnEndLink = Link<OnEnd, _Job>

/* **** State Flags **** */
export const PARKED_CONTINUE = 1 << 0  // 1
const PARKED_JOB = 1 << 1  // 2
const PARKED_CANCEL = 1 << 2  // 4
const PARKED_CANCEL_ERR = 1 << 3  // 8
export const PARKED_SLEEP = 1 << 4  // 16
export const PARKED_CH_PUT = 1 << 5  // 32
export const PARKED_CH_REC = 1 << 6  // 64
export const WAITING_CHILDREN = 1 << 7  // 128
const CHILDREN_CANCELLED = 1 << 8  // 256
const WAITING_ONENDS = 1 << 9  // 512
export const CANCELLED = 1 << 10  // 1024
export const SETTLED = 1 << 11  // 2048
const CANCOK = 1 << 12  // 4096
export const ERR_IN_GENFN = 1 << 13  // 8192
export const ERR_IN_ONEND = 1 << 14  // 16384
const CANCEL_SIBLINGS_ON_ERR = 1 << 15  // 32768
// todo: implement this when [Symbol.dispose] is implemented
// const JOB_IN_POOL = 1 << 16  // 65536

const PARKED_CH = PARKED_CH_PUT | PARKED_CH_REC
export const PARKED = PARKED_CONTINUE | PARKED_JOB | PARKED_CANCEL | PARKED_CANCEL_ERR| PARKED_SLEEP | PARKED_CH
const HAD_ERR = ERR_IN_GENFN | ERR_IN_ONEND
export const ANY_ERR_OR_CANCOK = HAD_ERR | CANCOK

/** Job Class
 *  _v:
 * 	Temporary slot for values: ch.put/rec, errors accumulation...
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
 * 	store it as the head of the LL and store its respective PARKED_XYZ flag.
 * 	The next links are to child jobs.
 *  _pr:
 * 	Link to parent job.
 *  _oe:
 * 	Singly LL of onEnds.
 *  _tm:
 * 	Timeout when yield* sleep() or some other inner timeout.
 *  _ctx:
 * 	Datalot potentially used by user or internally.
 */
export class _Job<Ok = unknown, E = unknown, Ctx = unknown> implements JobBase<Ok, E, Ctx> {

	_v = undefined as Ok | E
	_nm: string
	_st = 0
	_gn: RibuGen
	_ob: ObserverLink | VoidLink = VOID_LINK
	_tg: TgLink | VoidLink = VOID_LINK
	_pr: JobsLink | VoidLink = VOID_LINK
	_oe: OnEndLink | VoidLink = VOID_LINK
	_tm: NodeJS.Timeout | VoidObj = VOID_OBJ
	_ctx = null as Ctx

	constructor(name: string, gen?: RibuGen, parent?: _Job) {
		this._gn = gen ?? DUMMY_GEN
		this._nm = name
		if (parent) {
			const link = freshLink(parent, this)
			this._pr = link
			addTgLink(parent, link)
		}
	}
	_onTgDone(tgJob: _Job) {
		const { _st } = this

		if (_st & WAITING_CHILDREN) {
			onChildDone(this, tgJob)
			return
		}

		// Parked at yield* tgJob or yield* tgJob.handle/cancel/cancelErr.
		const { _st: tgSt } = tgJob

		const shouldThisJobFail =
			(_st & PARKED_JOB) && (tgSt & ANY_ERR_OR_CANCOK) ||
			(_st & PARKED_CANCEL) && (tgSt & ERR_IN_ONEND)

		if (shouldThisJobFail) {
			genFnFailed(this, _Err(this._nm, tgJob._v as Er))
			return
		}

		resumeJob(this, tgJob._v)
	}

	[Symbol.iterator]() {
		ensurePreviousYieldAndSetCallerJobNextSt(PARKED_JOB, `yield* ${this._nm}`)
		return jobIterator<Ok>(this)
	}

	get handle(): SysIterable<Ok | E> {
		return processHandle<Ok | E>(this)
	}

	cancel() {
		processCancel(this, ".cancel()", PARKED_CANCEL)
		return SYS_ITERABLE as SysIterable<void>
	}

	cancelHandle() {
		processCancel(this, ".cancelHandle()", PARKED_CANCEL_ERR)
		return SYS_ITERABLE as SysIterable<void | Er>
	}

	get _done() {
		return !!(this._st & SETTLED)
	}

	get _doneOk() {
		return this._done && !(this._st & ANY_ERR_OR_CANCOK)
	}

	get val() {
		return this._v
	}

	get _doneErr() {
		return this._done && !!(this._st & ANY_ERR_OR_CANCOK)
	}

	get reason() {
		return this._v
	}

	get cancelled() {
		return !!(this._st & CANCELLED)
	}

	get st() {
		if (this._done) return "done"
		if (this._doneErr) return "err"
		if (this._doneOk) return "ok"
		return "running"
	}

	byState() {
		return this as unknown as (
			| DoneJob<Ok, E, Ctx>
			| OkJob<Ok, Ctx>
			| ErrJob<E, Ctx>
		)
	}

	isDone(): this is DoneJob<Ok, E, Ctx> {
		return this._done
	}

	isOk(): this is OkJob<Ok, Ctx> {
		return this._doneOk
	}

	isErr(): this is ErrJob<E, Ctx> {
		return this._doneErr
	}

	setCtx<NewCtx>(ctx: NewCtx) {
		this._ctx = ctx as unknown as Ctx
		return this as unknown as Job<Ok, E, NewCtx>
	}

	get ctx() {
		return this._ctx
	}

	onEnd(onEndFn: OnEnd) {
		onEnd(onEndFn, this)
	}

	cancelSiblingsOnErr() {
		this._st |= CANCEL_SIBLINGS_ON_ERR
	}

	then(res: (val: Ok) => void, rej: (err: E) => void) {
		if (this._st & SETTLED) {
			resolveJobThenable(res, rej, this)
		}
		else {
			const link = freshLink(onJobDone, this)
			addObserver(this, link)
		}

		function onJobDone(_: unknown, thisJob: _Job) {
			resolveJobThenable(res, rej, thisJob)
		}
	}

	get promHandle(): Promise<Ok | E> {
		const self = this
		return new Promise<Ok | E>((res) => {
			if (self._st & SETTLED) {
				res(self._v)
			}
			else {
				const link = freshLink(res as OnJobDone, self)
				addObserver(self, link)
			}
		})
	}
}

export function processHandle<T>(job: _Job) {
	self = job
	ensurePreviousYieldAndSetCallerJobNextSt(PARKED_CONTINUE, ".handle")
	return JOB_ITERABLE as SysIterable<T>
}


function processCancel(job: _Job, opName: string, callerJobNextSt: _Job["_st"]) {
	if (job._st & SETTLED) {
		iterRes.done = true
		iterRes.value = undefined
		return
	}

	const callerJob = ensurePreviousYieldAndSetCallerJobNextSt(callerJobNextSt, opName)

	cancelJob(job)

	const { _st, _v: val } = job

	if (_st & SETTLED) {  // job settled synchronously just after canceJob() call above
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

function resolveJobThenable<OkRet, GetterErr>(res: (val: OkRet) => void, rej: (err: GetterErr) => void, thisJob: _Job) {
	const { _st, _v: val } = thisJob
	if (_st & ANY_ERR_OR_CANCOK) {
		rej(val as GetterErr)
	}
	else {
		res(val as OkRet)
	}
}


function jobIterator<T>(job: _Job) {
	let callerJob = sys.runningJob
	const callerSt = callerJob._st
	const thisSt = job._st

	if (thisSt & SETTLED) {

		// maybe unify this logic shared with Job._onTgJobDone()
		const shouldCallerFail =
			(callerSt & PARKED_JOB) && (thisSt & ANY_ERR_OR_CANCOK)

		if (shouldCallerFail) {
			genFnFailed(callerJob, _Err(callerJob._nm, job._v as Er))
			iterRes.done = false
		}
		else {
			callerJob._st &= ~PARKED
			iterRes.done = true
			iterRes.value = job._v
		}
	}
	else {
		linkJobs(callerJob, job)
		iterRes.done = false
	}

	return SYS_ITERATOR as SysIterator<T>
}


export const JOB_ITERABLE = {
	[Symbol.iterator]() {
		return jobIterator(self)
	}
}

export function resumeJob(thisJob: _Job, val?: unknown) {
	thisJob._st &= ~PARKED
	sys.pushJob(thisJob)

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
		var { done, value } = thisJob._gn.next()
	}
	catch (e) {
		genFnThrew = true
		value = e
	}

	sys.popJob()

	if (done === false) {
		return
	}

	if (value instanceof RibuErr) {
		genFnFailed(thisJob, decorateRibuErr(value, thisJob._nm))
	}
	else if (genFnThrew || value instanceof Error) {
		genFnFailed(thisJob, _Err(thisJob._nm, value))
	}
	else {
		thisJob._v = value
		onGenFnDone(thisJob)
	}
}

function onGenFnDone(thisJob: _Job, cancelChildren = false) {
	if (thisJob._tg === VOID_LINK) {
		execOnEndsRecur(thisJob)
		return
	}

	thisJob._st |= WAITING_CHILDREN
	loop_tg(thisJob, true, cancelChildren)
}

function genFnFailed(thisJob: _Job, jobVal: RibuErr) {
	thisJob._v = jobVal
	thisJob._st |= ERR_IN_GENFN
	thisJob._st |= CANCEL_SIBLINGS_ON_ERR
	onGenFnDone(thisJob, true)
}

const syncFnCtor = (function DUMMY_SYNC_FN() {}).constructor
const genFnCtor = (function* DUMMY_GEN_FN() {}).constructor

function execOnEndsRecur(thisJob: _Job) {
	const onEndLink = thisJob._oe
	if (onEndLink === VOID_LINK) {
		thisJob._st &= ~WAITING_ONENDS
		settleJob(thisJob)
		return
	}

	thisJob._st |= WAITING_ONENDS

	const onEnd = onEndLink.a as OnEnd
	thisJob._oe = onEndLink.nA as OnEndLink
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
		onOnEndResult(thisJob, retVal, onEnd, threw)
		return
	}

	if (onEndCtor === genFnCtor) {
		const onEndJob = new _Job(onEnd.name, (onEnd as RibuGenFn)())
		const observingLink = freshLink(onOnEndJobDone, thisJob)
		addObserver(onEndJob, observingLink)
		resumeJob(onEndJob)
		return
	}

	(onEnd as AsyncFn)()
		.then(val => onOnEndResult(thisJob, val, onEnd))
		.catch(e => onOnEndResult(thisJob, e, onEnd, true))
}

function onOnEndResult(thisJob: _Job, onEndResult: unknown, onEnd: OnEnd, threw = false) {
	if (onEndResult instanceof RibuErr) {
		addOnEndErr(thisJob, decorateRibuErr(onEndResult, onEnd.name))
	}
	else if (threw || onEndResult instanceof Error) {
		addOnEndErr(thisJob, _Err(onEnd.name, onEndResult))
	}

	execOnEndsRecur(thisJob)
}

function onOnEndJobDone(val: unknown, tg: _Job, ob: _Job) {
	if (tg._st & HAD_ERR) {
		if (val instanceof RibuErr) {
			addOnEndErr(ob, decorateRibuErr(val as RibuErr, ob._nm))
		}
		else if (val instanceof Error) {
			addOnEndErr(ob, _Err(ob._nm, val))
		}
	}
	execOnEndsRecur(ob)
}

function decorateRibuErr(ribuErr: RibuErr, fnName: string) {
	if (!ribuErr.fn && fnName !== "") {
		// @ts-ignore .fn being readonly.
		ribuErr.fn = fnName
	}
	return ribuErr
}

const CANCELLED_STR = "Cancelled"

function addOnEndErr(thisJob: _Job, err: Error | RibuErr) {
	addErrorToJobVal(thisJob, err, ERR_IN_ONEND)
	if (thisJob._st & CANCELLED) {
		// @ts-ignore job.val is Err now and mutation of .msg readonly property
		thisJob._v.msg = CANCELLED_STR
	}
}

function settleJob(thisJob: _Job) {
	// Release parent-child link.
	const { _pr, _st } = thisJob
	if (_pr !== VOID_LINK) {
		removeTgLink(_pr.a as _Job, _pr)
		thisJob._pr = VOID_LINK
		disposeLink(_pr)
	}

	if (_st & CANCELLED && !(_st & ERR_IN_ONEND)) {
		thisJob._v = E_CANC_OK
		thisJob._st = CANCOK
	}

	markSettledAndNotifyObs(thisJob)
}

type NotVoidObj<T> = T extends VoidObj ? never : T

export function markSettledAndNotifyObs(thisJob: _Job) {
	thisJob._st |= SETTLED
	const { _v: val } = thisJob
	// Notify observers.
	let obLink = thisJob._ob
	while (obLink !== VOID_LINK) {
		const nextLink = obLink.nA
		const observer = obLink.a
		if (typeof observer === "function") {
			type b = typeof obLink.b
			observer(val, thisJob, obLink.b as NotVoidObj<b>)
		}
		else {  // JobsLink
			removeOb(thisJob, obLink)
			removeTgLink(observer as _Job, obLink)
			disposeLink(obLink)
			;(observer as _Job)._onTgDone(thisJob)
		}
		obLink = nextLink
	}
}

function onChildDone(job: _Job, child: _Job) {
	if (child._st & HAD_ERR) {
		addErrorToJobVal(job, child._v as Er, ERR_IN_GENFN)
		const { _st } = job
		if ((_st & CANCEL_SIBLINGS_ON_ERR) && !(_st & CHILDREN_CANCELLED)) {
			loop_tg(job, false, true)
		}
	}

	if (job._tg === VOID_LINK) {
		execOnEndsRecur(job)
		return
	}
}

// Is cancelJob() caller responsibility to not subscribe if job is done,
// otherwise, observer job will be blocked forever.
const CANCEL_NOOP = SETTLED | WAITING_ONENDS
export function cancelJob(thisJob: _Job) {
	const { _st } = thisJob
	if (_st & CANCEL_NOOP) {
		return
	}

	thisJob._st |= CANCELLED

	if (_st & PARKED_SLEEP) {
		clearTimeout(thisJob._tm as NodeJS.Timeout)
		thisJob._st &= ~PARKED_SLEEP
		thisJob._tm = VOID_OBJ
	}
	else if (_st & PARKED_CH) {
		// todo: unsub from channel
	}
	else { // parked by a ::Job
		const link = thisJob._tg as JobsLink
		removeTgLink(thisJob, link)
		removeOb(link.b, link)
		disposeLink(link)
	}

	if (thisJob._tg === VOID_LINK) {
		execOnEndsRecur(thisJob)
		return
	}

	// Children already cancelled and job is linked/waiting for them.
	if (_st & CHILDREN_CANCELLED) {
		return
	}

	// Waiting for children but not cancelled yet, so trigger cancel
	// but don't link them again.
	if (thisJob._st & WAITING_CHILDREN) {
		loop_tg(thisJob, false, true)
		return
	}

	// Trigger cancel and link to them.
	loop_tg(thisJob, true, true)
}

export function loop_tg(thisJob: _Job, observe: boolean, cancel: boolean) {
	if (cancel) {
		thisJob._st |= CHILDREN_CANCELLED
	}

	let childLink = thisJob._tg
	// Can start loop right away bc caller guards against job state.
	do {
		let childJob = childLink.b as _Job
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

export function addErrorToJobVal(thisJob: _Job, err: Error | RibuErr, errFlag: _Job["_st"]) {
	if (!(thisJob._st & HAD_ERR)) {
		thisJob._v = _Err(thisJob._nm)
	}
	const errVal = thisJob._v as Er
	if (errFlag & ERR_IN_GENFN) {
		errVal._addErr(err)
	}
	else {
		errVal._addErr(err)
	}
	thisJob._st |= errFlag
	return errVal
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

export function addObserver<T = _Job>(thisJob: _Job, link: ObserverLink<T>) {
	let head = thisJob._ob
	thisJob._ob = link as ObserverLink
	if (head !== VOID_LINK) {
		link.nA = head as ObserverLink<T>
		head.pA = link as ObserverLink
	}
}

export function removeOb(thisJob: _Job, link: Link) {
	let { pA, nA } = link
	if (nA !== VOID_LINK) {
		nA.pA = pA
	}
	if (pA !== VOID_LINK) {
		pA.nA = nA
	}
	const head = thisJob._ob
	if (head === link) {
		thisJob._ob = nA as ObserverLink
	}
}

// We can safely add blocking target (Tg) and child jobs (Chd) as head
// always because:
// Tg behaves like a stack Link, ie, it is added as head when job is blocked
// and removed when job is resumed, ie, go(), which adds childs, can never
// be called in between block/unblock.
export function addTgLink(thisJob: _Job, link: TgLink) {
	let head = thisJob._tg
	thisJob._tg = link
	if (head !== VOID_LINK) {
		link.nB = head
		head.pB = link
	}
}

export function removeTgLink(thisJob: _Job, link: Link) {
	let { pB, nB } = link
	if (nB !== VOID_LINK) {
		nB.pB = pB
	}
	if (pB !== VOID_LINK) {
		pB.nB = nB
	}
	const head = thisJob._tg
	if (head === link) {
		thisJob._tg = nB as TgLink
	}
	// No need to set link.nA/pA to void since caller should
	// dispose the link immediately.
}

export function linkJobs(ob: _Job, tg: _Job) {
	const link = freshLink(ob, tg)
	addTgLink(ob, link)
	addObserver(tg, link)
}

export function unlinkFromAllJobs(thisJob: _Job) {
	let tgLink = thisJob._tg
	while (tgLink !== VOID_LINK) {
		const nextLink = tgLink.nB
		removeTgLink(thisJob, tgLink)
		removeOb(tgLink.b as _Job, tgLink)
		disposeLink(tgLink)
		tgLink = nextLink
	}
	thisJob._tg = VOID_LINK
}


/* Simple Job LL Iteration Protocol */

let currLink: Link | VoidLink = VOID_LINK

export function iter(head: Link | VoidLink): _Job | false {
	if (head === VOID_LINK) {
		return false
	}
	head = head as Link<_Job>
	currLink = head.nA
	return head.a as _Job
}

export function next(): _Job | false {
	if (currLink === VOID_LINK) {
		return false
	}
	const value = currLink.a
	currLink = currLink.nA
	return value as _Job
}



//* ****************   User API   ****************************************** *//

export interface JobBase<Ok = unknown, E = unknown, Ctx = unknown> {

	[Symbol.iterator]: () => SysIterator<Ok>
	readonly handle: SysIterable<Ok | E>
	setCtx: <NewCtx>(ctx: NewCtx) => Job<Ok, E, NewCtx>
	readonly ctx: Ctx
	cancel: () => SysIterable<void>
	cancelHandle: () => SysIterable<void | Er>
	onEnd: (fn: OnEnd) => void
	then: (res: (val: Ok) => void, rej: (err: E) => void) => void
	readonly promHandle: Promise<Ok | E>

	isDone: () => this is DoneJob<Ok, E, Ctx>
	isOk: () => this is OkJob<Ok, Ctx>
	isErr: () => this is ErrJob<E, Ctx>

	readonly st: "running" | "done" | "ok" | "err"
	byState: () =>
		| DoneJob<Ok, E, Ctx>
		| OkJob<Ok, Ctx>
		| ErrJob<E, Ctx>
}

export function go<Args extends unknown[], GenFnRet>(
	genFn: RibuGenFn<GenFnRet, Args>,
	...args: Args
): Job<NotErrs<GenFnRet>, Errs<GenFnRet> | ECancOk | Er> {
	const gen = genFn(...args)
	const job = new _Job(genFn.name, gen, sys.runningJob)
	resumeJob(job)
	return job as Job<NotErrs<GenFnRet>, Errs<GenFnRet> | ECancOk | Er>
}

export function me(): _Job {
	return sys.runningJob
}

export function onEnd(onEnd: OnEnd, thisJob = sys.runningJob) {
	let link = freshLink(onEnd, thisJob)
	let head = thisJob._oe
	thisJob._oe = link
	if (head !== VOID_LINK) {
		link.nA = head
	}
}



//* ****************   Types   ******************************************** *//

export type Job<Ok = unknown, E = unknown, Ctx = unknown> =
	JobBase<Ok, E, Ctx>

export type ByStateJobBase = {
	isOk: never
	isErr: never
	isDone: never
}

export type OkJob<Ok, Ctx = unknown> = JobBase<Ok, never, Ctx> & {
	readonly st: "ok"
	readonly val: Ok
} & ByStateJobBase

export type ErrJob<E, Ctx = unknown> = JobBase<never, E, Ctx> & {
	readonly st: "err"
	readonly reason: E
} & ByStateJobBase

export type DoneJob<Ok, E, Ctx = unknown> = JobBase<Ok, E, Ctx> & {
	readonly st: "done"
	readonly val: Ok | E
} & ByStateJobBase


export type Errs<T> = Extract<T, RibuErr>
export type NotErrs<T> = Exclude<T, RibuErr>
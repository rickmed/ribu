import {
	_Job,
	ERR_IN_GENFN,
	type Job,
	linkJobs,
	markSettledAndNotifyObs,
	SETTLED,
	CANCELLED,
	PARKED_CH_REC,
	unlinkFromAllJobs,
	OkJob,
	ErrJob,
	DoneJob,
	loop_tg,
	ERR_IN_ONEND,
	addErrorToJob,
	addTgLink,
	TgLink,
	removeTgLink,
	CANCOK,
} from "./job.js"
import { _E, ERR_CANC_OK, type Err } from "./errors.js"
import { VOID_LINK, VOID_OBJ } from "./system.js"


/* No yield* issue:
so check can be done at any ribu system part
operator sets PARKED and PENDING_YIELD = true
then, .next() sets PENDING_YIELD = false

if PENDING_YIELD = true, throw.


ok, which job forgot?
sys.runningJob
which op?
branch over job._st
- pleace function in all ops and resumeJob()

do few tests:
in child job, when op is last in job, etc.


*/

/*
Pool (select) supports
- .cancel()
	on yield* pool, parent should call headTg.unsub()
- .size (inFlight)
- [Symbol.dispose()], unsub from all jobs (for "using")

IMPLEMENTATION: use Job class.

NEEDED:
_st:
_v: could reuse for .count
_nm: could use it.
_onTgDone() -> overwrite
	pool job calls when done
	needs to override any ways.
_tg: keep jobs here.
_ob: all which call yield*


Pool Props Needed:
	fnArrJobIsDone:
		(this: Job, tgJob: Job) => void
	_ob:
		Needed if caller is cancelled, can remove itself from Pool._ob
	_tg: so that observing jobs can remove themselves from ob._tg when done


*/


/** *****************  Base JobPlus Class  ********************************** */

/**
 *  All JobPlus subclasses fail with Err("EmptyArguments") if passed-in array
 *  is empty.
 */

export const EMPTY_ARGS = "EmptyArgs"
export type EmptyArgsErr = Err<typeof EMPTY_ARGS>
export type NotErrs<Ret> = Exclude<Ret, Error>

const HALT = PARKED_CH_REC  // Can reuse Job flags since they won't be used in JobPlus instances.
const FAIL = HALT | ERR_IN_GENFN
export const SETTLED_OR_CANCELLED = SETTLED | CANCELLED
const SETTLED_OR_ERR_IN_GENFN = SETTLED | ERR_IN_GENFN

type JobOrJobThunkArr = Job[] | (() => Job)[]

export class JobPlus<Ok = unknown, E = unknown, Ctx = unknown> extends _Job<Ok, E, Ctx> {

	constructor() {
		super("")
	}

	_go(jobs: JobOrJobThunkArr, cancel = false) {
		if (jobs.length === 0) {
			this._st |= SETTLED_OR_ERR_IN_GENFN
			this._v = _E(EMPTY_ARGS, this._nm) as Ok | E
		}
		else {
			this._init()
			observeJobs(this, jobs, cancel)
		}
		return this
	}

	_onTgDone(tgJob: _Job): void {
		if (this._st & CANCELLED) {
			if (tgJob._st & ERR_IN_ONEND) {
				addErrorToJob(this, tgJob._v as Err, ERR_IN_GENFN)
			}
		}
		else {
			if (tgJob._doneErr) {
				this._onErrTgDone(tgJob)
			}
			else {
				this._onOkTgDone(tgJob)
			}
		}

		if (this._tg === VOID_LINK) {
			this._settleJob()
			return
		}

		if (this._st & HALT) {
			// Trigger cancel on rest of passed-in jobs
			this._st |= CANCELLED
			let jobLink = this._tg
			do {
				let job = jobLink.b as _Job
				const nextLink = jobLink.nB
				job._cancel()
				jobLink = nextLink
			} while (jobLink !== VOID_LINK)
		}
	}

	_settleJob() {
		this._st &= ~HALT
		if (this._tm !== VOID_OBJ) {
			clearTimeout(this._tm as NodeJS.Timeout)
			this._tm = VOID_OBJ
		}
		const thisSt = this._st
		if (thisSt & CANCELLED && !(thisSt & ERR_IN_ONEND)) {
			this._st = CANCOK
			this._v = ERR_CANC_OK as typeof this._v
		}
		markSettledAndNotifyObs(this)
	}

	_cancel() {
		if (this._st & SETTLED_OR_CANCELLED) {
			return
		}
		this._st |= CANCELLED
		loop_tg(this, false, true)
	}

	// To be overridden by subclasses
	_init(): void { }
	_onOkTgDone(_: Job) { }
	_onErrTgDone(_: Job) { }
}

function observeJobs(obJob: JobPlus, jobs: JobOrJobThunkArr, cancel = false) {
	let unsettledTargets = false
	const len = jobs.length
	for (let i = 0; i < len; i++) {

		const jobOrThunk = jobs[i]!
		const job = typeof jobOrThunk === "function" ? jobOrThunk() : jobOrThunk
		const res = checkIfTgSettledSync(obJob, job as _Job, unsettledTargets)
		if (res === 3) {
			return
		}
		if (res === 2) {
			continue
		}
		if (cancel) {
			(job as _Job)._cancel()
			const res = checkIfTgSettledSync(obJob, job as _Job, unsettledTargets)
			if (res === 3) {
				return
			}
			if (res === 2) {
				continue
			}
		}
		unsettledTargets = true
		linkJobs(obJob, job as _Job)
	}

	if (!unsettledTargets) {
		markSettledAndNotifyObs(obJob)
	}
}

// 1: tgJob didn't settle
// 2: tgJob settled but thisJob didn't halt
// 3: thisJob halted
function checkIfTgSettledSync(thisJob: JobPlus, tgJob: _Job, unsettledTargets: boolean): number {
	if (tgJob._st & SETTLED) {
		thisJob._onOkTgDone(tgJob)
		if (thisJob._st & HALT) {
			if (unsettledTargets) {
				unlinkFromAllJobs(thisJob)
			}
			thisJob._settleJob()
			return 3
		}
		return 2
	}
	return 1
}

type JobThunkArray<Jobs> = { [K in keyof Jobs]: () => Jobs[K] }

function makeJobCombinator<Jobs extends Job[], Ok, E>(
	name: string,
	_onOkTgDone?: (this: JobPlus, tgJob: Jobs[number]) => Ok,
	_onErrTgDoneExec?: (this: JobPlus, tgJob: Jobs[number]) => E,
	_init?: (this: JobPlus) => void,
	cancel = false
) {

	class JobCombinator extends JobPlus<Ok, E | Err<typeof EMPTY_ARGS>> {
		_nm = name
	}

	if (_onOkTgDone) {
		JobCombinator.prototype._onOkTgDone = _onOkTgDone
	}
	if (_onErrTgDoneExec) {
		JobCombinator.prototype._onErrTgDone = _onErrTgDoneExec
	}
	if (_init) {
		JobCombinator.prototype._init = _init
	}

	return factory

	function factory(fns: JobThunkArray<Jobs>) {
		const instance = new JobCombinator()
		return instance._go(fns, cancel) as Job<Ok, E | Err<typeof EMPTY_ARGS>>
	}
}

type AllOkRet<Jobs extends Job[]> = Jobs[number] extends Job<infer A, unknown> ? A : never



/** *****************  allOrErr()  *********************************************
 *
 *  Returns an array of the  _successful_ settled values of the passed-in jobs.
 *
 *  If one job fails (or is cancelled, even successfully), it fails. And the
 *  other passed-in jobs are cancelled.
 *
 *  Fails with Err("EmptyArguments") if passed-in array is empty.
 */
export const allOrErr = makeJobCombinator(
	"allOrErr",
	allOrErr_onOkTgJobDone,
	allOrErr_onErrTgJobDone,
	allOrErr_init
)

const JOB_HAD_ERR = "JobHadErr"
export type JobHadErr = Err<typeof JOB_HAD_ERR>

function allOrErr_onOkTgJobDone<Jobs extends Job[]>(this: JobPlus, tgJob: Jobs[number]) {
	let results = this._v as AllOkRet<Jobs>[]
	results.push((tgJob as _Job)._v as AllOkRet<Jobs>)
	return results
}

function allOrErr_onErrTgJobDone<Jobs extends Job[]>(this: JobPlus, tgJob: Jobs[number]) {
	this._st |= FAIL
	return this._v = _E(JOB_HAD_ERR, this._nm, (tgJob as _Job)._v as Err)
}

function allOrErr_init(this: JobPlus) {
	this._v = []
}







/** *****************  all()  *********************************************** */

// /*
// - Returns an array of the settled values of the passed-in jobs,
// 	ie, it waits for all to settle.
// - Returns error if empty array is passed-in.
//  */
// export function all<Jobs extends Job<unknown>[]>(...jobs: Jobs) {
// 	if (jobs.length === 0) {
// 		return []
// 	}
// 	const observer = new All<YielRet<Jobs[number]["val"]>>()
// 	onJobsDoneIntoChan(jobs, observer)
// 	return observer
// }

// class All<OkVals> extends Job<OkVals[]> {
// 	_nm = "all"
// 	val: OkVals[] = []

// 	_onTgDone(tgVal: unknown, tg: Job) {
// 		const { _tg, val } = this

// 		if (tg._st & ANY_ERR_OR_CANCOK) {
// 			addErrorToJobVal(this, tgVal as _Err)
// 			// unsubscribe from rest of jobs
// 			for (let link = _tg; link !== EMPTY_LINK; link = link.nA) {
// 				unlinkObAndTg(link)
// 			}
// 			this._st |= SETTLED
// 			notifyObservers(this, this.val)
// 			return
// 		}

// 		val.push(tgVal as OkVals)

// 		if (_tg === EMPTY_LINK) {
// 			this._st |= SETTLED
// 			notifyObservers(this, val)
// 			return
// 		}
// 	}
// }


/** *****************  first()  ********************************************* */


// /*
// - Returns the settled value of the first job that settles.
// - The rest are cancelled.
// - Settles with Error if passed-in array is empty.
//  */
// export function first<Jobs extends Job<unknown>[]>(...jobs: Jobs) {
// 	// what if first() is cancelled?
// 	// will run onEnds
// 	return go(function* _first() {

// 		onEnd(function* () {
// 			// unsub from rest of jobs here??
// 			yield* cancel(jobs)
// 		})

// 		if (jobs.length === 0) {
// 			return userErrCtor("EmptyArguments", "first")
// 		}

// 		const ev = Ev()
// 		for (const j of jobs) {
// 			j._onDone(j => ev.emit(j))
// 		}

// 		const job = (yield ev.wait) as Job
// 		// unsub from rest of jobs here
// 		return job.val as YielRet<Jobs[number]["val"]>
// 	})
// }


/** *****************  firstOk()  ******************************************* */

// /*
// - Returns the settled value of the first job that settles successfully.
// - The rest are cancelled.
// - The jobs that failed are ignored.
// - Settles with Error if all jobs fail.
// - Settles with Error if passed-in array is empty.
//  */
// export function firstOK<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

// 	return go(function* _firstOK() {

// 		if (jobs.length === 0) {
// 			return userErrCtor("EmptyArguments", "firstOK")
// 		}

// 		const ev = Ev()
// 		for (const j of jobs) {
// 			j._onDone(j => ev.emit(j))
// 		}

// 		let inFlight = jobs.length
// 		while (inFlight--) {
// 			const job = (yield ev.wait) as Job
// 			if (job.failed) {
// 				continue
// 			}
// 			yield cancel(jobs)
// 			return job.val as YielRet<Jobs[number]["val"]>
// 		}

// 		return userErrCtor("AllJobsFailed", "firstOK")
// 	})
// }



/** *****************  Utils  *********************************************** */

export function groupByState<J extends Job>(jobs: J[]) {
	let ok: PrettyOkJob<J>[] = []
	let err: PrettyErrJob<J>[] = []
	let live: J[] = []
	for (let i = 0; i < jobs.length; i++) {
		const job = jobs[i]!
		if (isOkJob(job)) {
			ok.push(job)
		}
		else if (isErrJob(job)) {
			err.push(job)
		}
		else {
			live.push(job)
		}
	}
	return { ok, err, live }
}

function isOkJob<J extends Job>(job: J): job is OkJobFrom<J> {
	return (job as unknown as _Job)._doneOk
}

type OkJobFrom<J> = J extends Job<infer Ok, infer _E, infer Ctx>
	? J & OkJob<Ok, Ctx>
	: never

type PrettyOkJob<J> = J extends Job<infer Ok, infer _E, infer Ctx>
	? OkJob<Ok, Ctx>
	: never

function isErrJob<J extends Job>(job: J): job is ErrJobFrom<J> {
	return (job as unknown as _Job)._doneErr
}

type ErrJobFrom<J> = J extends Job<infer _Ok, infer E, infer Ctx>
	? J & ErrJob<E, Ctx>
	: never

type PrettyErrJob<J> = J extends Job<infer _Ok, infer E, infer Ctx>
	? ErrJob<E, Ctx>
	: never

export function doneJob<J extends Job>(job: J): job is DoneJobFrom<J> {
	return !(job as unknown as _Job)._done
}

type DoneJobFrom<J> = J extends Job<infer _Ok, infer E, infer Ctx>
	? J & DoneJob<_Ok, E, Ctx>
	: never


// /* **********  newJob  ********** */

// const dummyGen = (function* dummyGenFn() {})()

// export function newJob<Ret = unknown, Errs = ErrCancOk |  | __Err>(jobName = "") {
// 	return new Job<Ret, Errs | ErrCancOk |  | __Err>(dummyGen, jobName)
// }



// //* **********  Promise to Job  ********** *//

// export function promToJob<T>(p: Promise<T>) {
// 	const job = newJob<T, E<"PromiseRejected">>()

// 	p.then(
// 		ok => job.settle(ok),
// 		e => job.settle(userErrCtor("PromiseRejected", "fromProm", "", e))
// 	)

// 	return job
// }

export function steal(job: _Job, newParent: _Job) {
	const { _pr } = job
	if (_pr === VOID_LINK) {
		return
	}
	removeTgLink(job, _pr)
	addTgLink(newParent, _pr as TgLink)
}

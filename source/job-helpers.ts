import {
	cancelJob,
	ERR_IN_GENFN,
	type _Job,
	type Job,
	linkJobs,
	markSettledAndNotifyObs,
	 PARKED_CH_REC, SETTLED,
	  unlinkFromAllJobs,
	  ANY_ERR_OR_CANCOK,
	  OkJob,
	  ErrJob,
	  GetTypes,
	  Errs,
	} from "./job.js"
import { Er, Err } from "./errors.js"
import { VOID_LINK, VOID_OBJ } from "./system.js"

// todo: consider passing a timeout parameter

// todo:
// make a (slower) wait-group like that implements interator so that
// for (const job of waitGroup) works.

/*
Optional Add-ons Later
You could extend Pool to support:

cancelRemaining() — for early exits

timeout(ms) — to fail the pool after a deadline

progress tracking (settled / total ratio)

onEach(fn) — observe every job as it completes



| Category        | Method / Property           | Description                                                                 |
|----------------|-----------------------------|-----------------------------------------------------------------------------|
| 🧠 Tracking     | `pool.settledCount`         | Number of jobs that have finished                                           |
|                | `pool.failedCount`          | Number of jobs that failed                                                  |
|                | `pool.okCount`              | Number of jobs that succeeded                                               |
|                | `pool.remainingJobs()`      | Returns array of jobs that haven't settled yet                              |
|                | `pool.progress()`           | Returns object: `{ total, settled, failed, ok }`                            |
|                | `pool.status()`             | Returns summary string: "5/10 settled (3 ok, 2 failed)"                     |
|----------------|-----------------------------|-----------------------------------------------------------------------------|
| 🔁 Control      | `pool.cancelRemaining()`    | Cancels all in-flight jobs                                                  |
|                | `pool.timeout(ms)`          | Fails the pool if not complete within given time                            |
|                | `pool.awaitAtLeast(n)`      | Yields once *n* jobs have settled                                           |
|                | `pool.awaitNOk(n)`          | Yields once *n* jobs have succeeded                                         |
|----------------|-----------------------------|-----------------------------------------------------------------------------|
| 👁️ Observability | `pool.onEach(fn)`           | Calls `fn(job)` every time a job settles                                    |
|                | `pool.onEnd(fn)`            | Calls `fn()` when all jobs are finished                                     |
|----------------|-----------------------------|-----------------------------------------------------------------------------|
| 🧩 Grouping     | `pool.groupBy(fn)`          | Groups jobs by key derived from `fn(job)`                                   |
|                | `pool.partition()`          | Returns `[okJobs, failedJobs]` (original jobs, just filtered)               |
|----------------|-----------------------------|-----------------------------------------------------------------------------|
| 🧪 Utilities    | `pool.retryFailed(n)`       | Retries failed jobs up to `n` times                                         |
|                | `pool.cleanFailed()`        | Removes failed jobs from the pool                                           |
|                | `pool.shuffle()`            | Randomizes job order (for stress testing)                                   |
|                | `pool.testMode()`           | Makes job behavior predictable for testing                                  |

Method / Property	Description
pool.getFirstOk()	Returns the first job that succeeded (or null)
pool.getFirstFailure()	Returns the first job that failed
pool.failedJobs()	Shortcut for jobs.filter(j => j.failed)
pool.okJobs()	Shortcut for jobs.filter(j => j.ok)
pool.avgDuration()	Average duration of completed jobs (if jobs track .startTime / .endTime)
pool.longestJob()	Returns the job with the highest duration
pool.lastSettled()	Returns the most recently completed job (live or after awaitAll)

Method	Description
pool.pause() / resume()	Temporarily stop the pool from starting or reacting to jobs
pool.throttle(n)	Run only n jobs concurrently (like a batch limiter)
pool.awaitFirstOkThenCancel()	Resolves on first success, cancels rest
pool.awaitMajority()	Resolves once >50% jobs are settled
pool.until(conditionFn)	Continues yielding until custom condition returns true
pool.awaitOkRatio(ratio)	Resolves when okCount / total >= ratio

pool.isIdle()	Returns true if all jobs are settled (i.e. inFlight === 0)
*/



/**
 *  When helper is done, it NEVER cancels the other passed-in jobs.
 *   Are only "unlinked" from passed-in jobs when it returns.
 *
 *  Other jobs are cancelled only if yield* helper.cancel() is called.
 *    This is the equivalent of yield* cancel(...passedInJobs)
 *
 *  Although, if plain yield* jobHelper(...jobs) is used, and jobHelper
 *    fails (returns ::Err, for example), the caller will fail, so if
 *    the passed-in jobs are chilren of caller, they'll be cancelled
 *    via parent's automatic structured concurrency anyway.
 *
 *  All fail with Err("EmptyArguments") if passed-in array is empty.
 */


/** *****************  Base JobPlus Class  ********************************** */

export const EMPTY_ARGS = "EmptyArguments"
export type EmptyArgsErr = Err<typeof EMPTY_ARGS>
export type NotErrs<Ret> = Exclude<Ret, Error>

// Reuse Job flags since they won't be used in JobPlus instances.
const HALT = PARKED_CH_REC
export const FAIL = HALT | ERR_IN_GENFN

export const TIME_OUT = "Timeout"
export type TimeoutErr = Err<typeof TIME_OUT>

abstract class JobPlus<OkRet = unknown, AllRet = unknown> extends Job<OkRet, AllRet> {
	constructor() {
		super("")
	}

	maxWait(ms: number) {
		this._tm = setTimeout(maxWaitFired, ms, this)
		return this as Job<OkRet, AllRet | TimeoutErr>
	}

	_go(jobs: Job[], cancel = false) {
		if (jobs.length === 0) {
			this._st |= (SETTLED | ERR_IN_GENFN)
			this._v = Err(EMPTY_ARGS, this._nm) as AllRet
		}
		else {
			this._init()
			observeJobs(this, jobs, cancel)
		}
		return this
	}

	_onTgDone(tgJob: Job): void {
		this._onTgJobDone(tgJob)
		if (this._tg === VOID_LINK) {
			settleJob(this)
			return
		}
		if (this._st & HALT) {
			unlinkFromAllJobs(this)
			settleJob(this)
			return
		}
	}

	// To be overridden by subclasses
	_init(): void {}
	_onTgJobDone(_: Job) {}
}

function settleJob(thisJob: JobPlus) {
	thisJob._st &= ~HALT
	if (thisJob._tm !== VOID_OBJ) {
		clearTimeout(thisJob._tm as NodeJS.Timeout)
		thisJob._tm = VOID_OBJ
	}
	markSettledAndNotifyObs(thisJob)
}

function maxWaitFired(thisJob: JobPlus) {
	thisJob._tm = VOID_OBJ
	// Reset ._st and .val in case some passed-in jobs already settled with Err.
	thisJob._st = 0
	thisJob._v = Err(TIME_OUT, thisJob._nm)
	// Make caller fail if it didn't call .err.
	thisJob._st |= ERR_IN_GENFN
	unlinkFromAllJobs(thisJob)
	markSettledAndNotifyObs(thisJob)
}

export function observeJobs(obJob: JobPlus, jobs: Job[], cancel = false) {
	let unsettledTargets = false
	const len = jobs.length
	for (let i = 0; i < len; i++) {
		const job = jobs[i]!
		const res = checkIfTgSettledSync(obJob, job, unsettledTargets)
		if (res === 3) {
			return
		}
		if (res === 2) {
			continue
		}
		if (cancel) {
			cancelJob(job)
			const res = checkIfTgSettledSync(obJob, job, unsettledTargets)
			if (res === 3) {
				return
			}
			if (res === 2) {
				continue
			}
		}
		unsettledTargets = true
		linkJobs(obJob, job)
	}
	if (!unsettledTargets) {
		markSettledAndNotifyObs(obJob)
	}
}

// 1: tgJob didn't settle
// 2: tgJob settled but thisJob didn't halt
// 3: thisJob halted
function checkIfTgSettledSync(thisJob: JobPlus, tgJob: Job, unsettledTargets: boolean): number {
	if (tgJob._st & SETTLED) {
		thisJob._onTgJobDone(tgJob)
		if (thisJob._st & HALT) {
			if (unsettledTargets) {
				unlinkFromAllJobs(thisJob)
			}
			settleJob(thisJob)
			return 3
		}
		return 2
	}
	return 1
}

export function ExtendJobPlus<Jobs extends Job[], Ret>(
	name: string,
	_onTgJobDone: (this: Job, tgJob: Jobs[number]) => Ret,
	_init?: (this: Job) => void,
	cancel = false
) {

	class JobP extends JobPlus<NotErrs<Ret>, Ret | Err<typeof EMPTY_ARGS>> {
		_nm = name
	}

	JobP.prototype._onTgJobDone = _onTgJobDone
	if (_init) {
		JobP.prototype._init = _init
	}

	return factory

	function factory(...jobs: Jobs) {
		const instance = new JobP()
		return instance._go(jobs, cancel)
	}
}


type AllOkRet<Jobs extends Job[]> = Jobs[number] extends Job<infer A, unknown> ? A : never



/** *****************  allOrErr()  ****************************************** */

/** allOrErr()
 *  Returns an array of the  _successful_ settled values of the passed-in jobs.
 *  If one job fails (or is cancelled, even successfully), it fails.
 *  Fails also if the passed-in array is empty.
 */
export const allOrErr = ExtendJobPlus("allOrErr", allOrErrOnTgJobDone, allOrErrInit)

const JOB_HAD_ERR = "JobHadErr"
export type JobHadErr = Err<typeof JOB_HAD_ERR>

function allOrErrOnTgJobDone<Jobs extends Job[]>(this: Job, tgJob: Jobs[number]) {
	if (tgJob.doneErr) {
		this._st |= FAIL
		return this._v = Err(JOB_HAD_ERR, this._nm, "", tgJob._v as Er)
	}
	let results = this._v as AllOkRet<Jobs>[]
	results.push(tgJob._v a	 AllOkRet<Jobs>)
	return results
}

function allOrErr	nit(this: Job) {
	this._v = []
}


/* No .mapOut!!!, people map themselves.



*****
allOrErr() / P.all() -> if Job failed, fail fast.
	ok -> Job<JobOkRet>[]
	err -> JobHadErr<failedJob> | Job<JobOkRet>[]
all() | P.allSettled() -> waits for all jobs to settle.
	ok -> Job<JobAllRet>
	err -> never
Promise.race() / first() -> settles when a job settled.
	ok -> Job<JobAllRet>
	err -> never
Promise.any() / firstOk() -> settles when first successful job.
	ok -> Job<JobOkRet>
	err -> Err<"AllJobsFailed">





WHAT GENERAL CLASS TO USE
need a PoolBase that I give an array of jobs and let me know when
  a job settled.
	- cancel? cancelErr? unSub? maxWait?

Job Class is used currently, but these props are not being used:
	_gn: generator
	_pr: parent
	_oe: onEnds

Pool Props Needed:
	fnArrJobIsDone:
		(this: Job, tgJob: Job) => void
	_ob:
		Needed if caller is cancelled, can remove itself from Pool._ob
	_tg: so that observing jobs can remove themselves from ob._tg when done




all:
	- Need to count jobs?

*/

// todo: provide map, filter, reduce helpers.



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


export function isOk<J extends Job>(job: J): job is OkJobFrom<J> {
	return (job as unknown as _Job)._doneOK
}

export function isErr<J extends Job>(job: J): job is ErrJobFrom<J> {
	return (job as unknown as _Job)._doneErr
}


export function groupByState<J extends Job>(jobs: J[]) {
	const doneOk: PrettyOkJob<J>[] = []
	const doneErr: PrettyErrJob<J>[] = []
	const notDone: J[] = []
	for (let i = 0; i < jobs.length; i++) {
		const job = jobs[i]!
		if (isOk(job)) {
			doneOk.push(job)
		}
		else if (isErr(job)) {
			doneErr.push(job)
		}
		else {
			notDone.push(job)
		}
	}
	return { doneOk, doneErr, notDone }
}

type OkJobFrom<J> = J extends Job<infer Ret, infer Ctx>
	? J & OkJob<NotErrs<Ret>, Ctx>
	: never

type PrettyOkJob<J> = J extends Job<infer Ret, infer Ctx>
	? OkJob<NotErrs<Ret>, Ctx>
	: never

type ErrJobFrom<J> = J extends Job<infer Ret, infer Ctx>
	? J & ErrJob<Errs<Ret>, Ctx>
	: never

type PrettyErrJob<J> = J extends Job<infer Ret, infer Ctx>
	? ErrJob<Errs<Ret>, Ctx>
	: never






// /* **********  newJob  ********** */

// const dummyGen = (function* dummyGenFn() {})()

// export function newJob<Ret = unknown, Errs = ECancOK |  | __Err>(jobName = "") {
// 	return new Job<Ret, Errs | ECancOK |  | __Err>(dummyGen, jobName)
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

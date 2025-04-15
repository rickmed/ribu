import {
	_Job,
	cancelJob,
	ERR_IN_GENFN,
	type Job,
	linkJobs,
	markSettledAndNotifyObs,
	PARKED_CH_REC, SETTLED,
	unlinkFromAllJobs,
	OkJob,
	ErrJob,
	DoneJob,
	processHandle,
	WAITING_CHILDREN,
	ERR_IN_ONEND,
	addErrorToJobVal,
	removeTgLink,
	addTgLink,
	TgLink,
} from "./job.js"
import { _E, type Err } from "./errors.js"
import { SysIterable, VOID_LINK, VOID_OBJ } from "./system.js"

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


/** *****************  Base JobPlus Class  ********************************** */

/**
 *  All JobPlus subclasses fail with Err("EmptyArguments") if passed-in array
 *  is empty.
 */

export const EMPTY_ARGS = "EmptyArgs"
export type EmptyArgsErr = Err<typeof EMPTY_ARGS>
export type NotErrs<Ret> = Exclude<Ret, Error>

// Reuse Job flags since they won't be used in JobPlus instances.
const HALT = PARKED_CH_REC
const FAIL = HALT | ERR_IN_GENFN
const WAITING_CANCELLED_JOBS = WAITING_CHILDREN

export const TIME_OUT = "Timeout"
export type TimeoutErr = Err<typeof TIME_OUT>

export class JobPlus<Ok = unknown, E = unknown, Ctx = unknown>
	extends _Job<Ok, E, Ctx> {

	constructor() {
		super("")
	}

	get handle(): SysIterable<Ok | E> {
		return processHandle(this)
	}

	maxWait(ms: number) {
		this._tm = setTimeout(maxWaitFired, ms, this)
		return this as _Job<Ok, Ok | E | TimeoutErr, Ctx>
	}

	_go(jobs: Job[], cancel = false) {
		if (jobs.length === 0) {
			this._st |= (SETTLED | ERR_IN_GENFN)
			this._v = _E(EMPTY_ARGS, this._nm) as Ok | E
		}
		else {
			this._init()


			observeJobs(this, jobs, cancel)
		}
		return this
	}

	_onTgDone(tgJob: Job): void {
		if (this._st & WAITING_CANCELLED_JOBS) {
			if ((tgJob as _Job)._st & ERR_IN_ONEND) {
				addErrorToJobVal(this, (tgJob as _Job)._v as Err, ERR_IN_GENFN)
			}
		}
		else {
			if ((tgJob as _Job)._doneErr) {
				this._onFailedTgDoneExec(tgJob)
			}
			else {
				this._onTgDoneExec(tgJob)
			}
		}

		if (this._tg === VOID_LINK) {
			this._settleJob()
			return
		}
		if (this._st & HALT) {
			// Trigger cancel on rest of passed-in jobs
			this._st |= WAITING_CANCELLED_JOBS
			let jobLink = this._tg
			do {
				let job = jobLink.b as _Job
				const nextLink = jobLink.nB
				cancelJob(job)
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
		markSettledAndNotifyObs(this)
	}

	_settleCancel() {

	}

	// To be overridden by subclasses
	_init(): void {}
	_onTgDoneExec(_: Job) {}
	_onFailedTgDoneExec(_: Job) {}
}


function maxWaitFired(thisJob: JobPlus) {
	thisJob._tm = VOID_OBJ
	// Reset ._st and .val in case some passed-in jobs already settled with Err.
	thisJob._st = 0
	thisJob._v = _E(TIME_OUT, thisJob._nm)
	// Make caller fail if it didn't call .handle.
	thisJob._st |= ERR_IN_GENFN
	unlinkFromAllJobs(thisJob)
	markSettledAndNotifyObs(thisJob)
}

function observeJobs(obJob: JobPlus, jobs: Job[], cancel = false) {
	let unsettledTargets = false
	const len = jobs.length
	for (let i = 0; i < len; i++) {

		const job = jobs[i]!
		const res = checkIfTgSettledSync(obJob, job as _Job, unsettledTargets)
		if (res === 3) {
			return
		}
		if (res === 2) {
			continue
		}
		if (cancel) {
			cancelJob(job as _Job)
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
		thisJob._onTgDoneExec(tgJob)
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

function steal(job: _Job, newParent: _Job) {
	const { _pr } = job
	if (_pr === VOID_LINK) {
		return
	}
	removeTgLink(job, _pr)
	addTgLink(newParent, _pr as TgLink)
}

function makeJobCombinator<Jobs extends Job[], Ok, E>(
	name: string,
	_onTgJobDone?: (this: JobPlus, tgJob: Jobs[number]) => Ok,
	_onFailedTgJobDone?: (this: JobPlus, tgJob: Jobs[number]) => E,
	_init?: (this: JobPlus) => void,
	cancel = false
) {

	class JobCombinator extends JobPlus<Ok, E | Err<typeof EMPTY_ARGS>> {
		_nm = name
	}

	if (_onTgJobDone) {
		JobCombinator.prototype._onTgDoneExec = _onTgJobDone
	}
	if (_onFailedTgJobDone) {
		JobCombinator.prototype._onFailedTgDoneExec = _onFailedTgJobDone
	}
	if (_init) {
		JobCombinator.prototype._init = _init
	}

	return factory

	function factory(jobs: Jobs) {
		const instance = new JobCombinator()
		return instance._go(jobs, cancel)
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
	allOrErrOnTgJobDone,
	allOrErrOnFailedTgJobDone,
	allOrErrInit
)

const JOB_HAD_ERR = "JobHadErr"
export type JobHadErr = Err<typeof JOB_HAD_ERR>

function allOrErrOnTgJobDone<Jobs extends Job[]>(this: JobPlus, tgJob: Jobs[number]) {
	let results = this._v as AllOkRet<Jobs>[]
	results.push((tgJob as _Job)._v as AllOkRet<Jobs>)
	return results
}

function allOrErrOnFailedTgJobDone<Jobs extends Job[]>(this: JobPlus, tgJob: Jobs[number]) {
	this._st |= FAIL
	return this._v = _E(JOB_HAD_ERR, this._nm, (tgJob as _Job)._v as Err)
}

function allOrErrInit(this: JobPlus) {
	this._v = []
}



/*

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

// export function newJob<Ret = unknown, Errs = ErCancOK |  | __Err>(jobName = "") {
// 	return new Job<Ret, Errs | ErCancOK |  | __Err>(dummyGen, jobName)
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

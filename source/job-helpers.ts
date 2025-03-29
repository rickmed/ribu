import { ERR_IN_GENFN, Job, markSettledAndNotifyObs, observeJobs, PARKED_CH_REC, SETTLED } from "./job.js"
import { Err } from "./errors.js"
import { VOID_LINK } from "./system.js"

// todo: consider passing a timeout parameter

// todo:
// make a (slower) wait-group like that implements interator so that
// for (const job of waitGroup) works.


//* *******************  Job Combinators  ********************************** *//

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

export const EMPTY_ARGS = "EmptyArguments"
export type NotErrs<Ret> = Exclude<Ret, Error>

// Reuse Job flags since they won't be used in JobPlus instances.
const HALT = PARKED_CH_REC
const FAIL = HALT | ERR_IN_GENFN

class JobPlus<OkRet = unknown, AllRet = unknown> extends Job<OkRet, AllRet | Err<"EmptyArguments">> {
	constructor() {
		super("")
	}

	_go(jobs: Job[], cancel = false) {
		if (jobs.length === 0) {
			this._st |= (SETTLED | ERR_IN_GENFN)
			this.val = new Err(EMPTY_ARGS, this._nm) as AllRet
		}
		else {
			this._init()
			observeJobs(this, jobs, cancel)
		}
		return this
	}

	_onTgDone(tgJob: Job): void {
		const val = this._onTgJobDone(tgJob) as AllRet
		const { _st, _tg } = this
		if (_tg === VOID_LINK) {
			this.val = val
			markSettledAndNotifyObs(this)
			return
		}
		if (_st & HALT) {
			this._st &= ~HALT
			this.val = val
			markSettledAndNotifyObs(this)
			return
		}
	}

	// Implemented in subclass
	_init() {}

	// Implemented in subclass
	_onTgJobDone(_: Job) {}
}

type OnTgDoneRet<T extends Job[]> = ReturnType<typeof allOrErrOnTgDone<T>>


/** allOrErr()
 *  Returns an array of the  _successful_ settled values of the passed-in jobs.
 *  If one job fails (or is cancelled, even successfully), it fails.
 *  Fails also if the passed-in array is empty.
 */

// todo: abstract this into class factory.
export function allOrErr<Jobs extends Job[]>(...jobs: Jobs) {
	type Ret = OnTgDoneRet<Jobs>
	return new _allOrErr()._go(jobs) as JobPlus<NotErrs<Ret>, Ret>
}

class _allOrErr extends JobPlus {
	_nm = "allOrErr"
}

_allOrErr.prototype._onTgJobDone = allOrErrOnTgDone
_allOrErr.prototype._init = allOrErrOnInit

function allOrErrOnTgDone<Jobs extends Job[]>(this: Job, tg: Job) {
	if (tg.hadErr) {
		// eslint-disable-next-line functional/immutable-data
		this._st |= FAIL
		return new Err("JobHadErr", this._nm, tg.val)
	}
	let jobsResults = this.val as AllOkRet<Jobs>[]
	jobsResults.push(tg.val)
	return jobsResults
}

function allOrErrOnInit(this: Job) {
	// eslint-disable-next-line functional/immutable-data
	this.val = []
}





type OkRet<J> = J extends Job<infer A, infer B> ? [A, B] : never

type AllOkRet<Jobs extends Job[]> = OkRet<Jobs[number]>[0]


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

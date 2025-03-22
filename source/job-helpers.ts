// import { DONE, ANY_ERR_OR_CANCOK, Job, Job, addErrorToJobVal, cancel, go, notifyObservers, subscribeToAllJobs as subscribeToJobs, type YielRet, ERR_IN_GENFN, execSettle, cancelJob, onEnd, CANCELLED } from "./job.js"
// import { userErrCtor, _Err, Err } from "./errors.js"
// import { Ob, Tg, unlinkObAndTg } from "./system.js"


// const EmptyArgsErr = userErrCtor("EmptyArgumentsErr")
// export type EmptyArgsErr = typeof EmptyArgsErr



// function unLinkFromTargets(ob: Ob) {
// 	while (ob._tg) {
// 		const link = ob._tg
// 		ob._tg = link.nA
// 		unlinkObAndTg(link)
// 	}
// }



// // helpers must set correct _st to that inherited [symbol.iterator] works ok

// /*
// => thinking about helper._cancel() implementation, what logic from cancelJob()
// 	think that helper is aleady subscribed to jobs so maybe
// 	just trigget cancelJob(job) is sufficient
// 	- but need to handle if job had cancel errors (?)

// => See how would implement job/genFn based and see if helps class based.
//  - if not, implement all job/genFn based helpers - DO THIS!!!!!


// */

// /*
// - Returns an array of the settled _successful_ values of the passed-in jobs.
// - If one job fails (or is cancelled, even successfully), it settles with Error
// 	and fails callerJob if not using .err
// - Settles with Error if the passed-in array is empty.
//  */
// export function allOrErr<Jobs extends Job<unknown>[]>(...jobs: Jobs) {
// 	type YieldRet = YielRet<Jobs[number]["val"]>
// 	return new AllOrErr<YieldRet>(jobs)
// }

// class AllOrErr<T> extends Job<T[], T[] | EmptyArgsErr | Err<string>> {
// 	_nm = "allOrErr"
// 	val: T[] = []

// 	constructor(jobs: Job<unknown>[]) {
// 		super()
// 		if (jobs.length === 0) {
// 			addErrorToJobVal(this, EmptyArgsErr, ERR_IN_GENFN)
// 			this._settle()
// 			return
// 		}
// 		subscribeToJobs(jobs, this)
// 	}

// 	_onTgDone(tgVal: unknown, tg: Tg) {
// 		const { _st, _tg, val: thisVal } = this

// 		if (_st & CANCELLED) {
// 			if (!_tg) {
// 				this._settle()
// 				return
// 			}
// 			// else accumulate errors or what?
// 		}

// 		if (tg._st & ANY_ERR_OR_CANCOK) {
// 			addErrorToJobVal(this, tgVal, ERR_IN_GENFN)
// 			unLinkFromTargets(this)
// 			this._settle()
// 			return
// 		}

// 		thisVal.push(tgVal as T)

// 		if (!this._tg) {
// 			this._settle()
// 			return
// 		}
// 	}

// 	_cancel(): void {
// 		while (this._tg) {
// 			cancelJob(this._tg.b as Job)
// 			this._tg = this._tg.nA
// 		}
// 	}

// 	_fail(tgVal: unknown) {
// 		// todo

// 		// calls this._settle()
// 	}

// 	_settle() {
// 		execSettle(this)
// 	}
// }












// /*
// - Returns an array of the settled values of the passed-in jobs,
// 	ie, it waits for all to settle.
// - Returns an empty array if the passed-in array in empty.
//  */
// export function all<Jobs extends Job<unknown>[]>(...jobs: Jobs) {
// 	if (jobs.length === 0) {
// 		return []
// 	}
// 	const observer = new All<YielRet<Jobs[number]["val"]>>()
// 	subscribeToJobs(jobs, observer)
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
// 			this._st |= DONE
// 			notifyObservers(this, this.val)
// 			return
// 		}

// 		val.push(tgVal as OkVals)

// 		if (_tg === EMPTY_LINK) {
// 			this._st |= DONE
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


// //* *************************  JobSelect *********************************** *//











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

import { DONE, ANY_ERR_OR_CANCOK, Job, JobBase, addErrorToJobVal, cancel, go, notifyObservers, subscribeToAllJobs, type NotErrs } from "./job.ts"
import { userErrCtor, _Err, Err } from "./errors.ts"
import { Ob, Tg, unlinkObAndTg } from "./system.ts"

// helpers must set correct _st to that [symbol.iterator] works ok


function unLinkFromAllTargets(ob: Ob) {
	for (let link = ob._tg; link !== EMPTY_LINK; link = link.nA) {
		unlinkObAndTg(link)
	}
}

const EmptyArgsErr = userErrCtor("EmptyArguments")
export type EmptyArgsErr = typeof EmptyArgsErr

/*
- Returns an array of the settled not ::Error values of the passed-in jobs.
- If one job fails, it returns Error (fails callerJob if not using .err)
- Resolves to an empty array if the passed-in array in empty.
 */
export function allOrErr<Jobs extends Job<unknown>[]>(...jobs: Jobs) {
	type YieldRet = NotErrs<Jobs[number]["val"]>
	return new AllOrErr<YieldRet>(jobs)
}

class AllOrErr<T> extends JobHelper<T[], T[] | EmptyArgsErr | _Err> {
	_nm = "allOrErr"
	val: T[] = []

	constructor(jobs: Job<unknown>[]) {
		super()
		if (jobs.length === 0) {
			addErrorToJobVal(this, EmptyArgsErr)
			this._st |= DONE
			return
		}
		subscribeToAllJobs(jobs, this)
	}

	_onTgDone(tgVal: unknown, tg: Job) {
		const { _tg, val } = this

		if (tg._st & ANY_ERR_OR_CANCOK) {
			addErrorToJobVal(this, tgVal as _Err)
			unLinkFromAllTargets(this)
			this._st |= DONE
			notifyObservers(this, this.val)
			return
		}

		val.push(tgVal as T)

		if (_tg === EMPTY_LINK) {
			this._st |= DONE
			notifyObservers(this, val)
			return
		}
	}
}




export function allOrErr2<Jobs extends Job<unknown>[]>(...jobs: Jobs) {
	type YieldRet = NotErrs<Jobs[number]["val"]>
	return new AllOrErr2<YieldRet>(jobs)
}



class AllOrErr2<T> extends JobBase<T[], T[] | EmptyArgsErr | Err> {
	_nm = "allOrErr"
	val: T[] = []

	constructor(jobs: Job<unknown>[]) {
		super()
		if (jobs.length === 0) {
			addErrorToJobVal(this, EmptyArgsErr)
			this._st |= DONE
			return
		}
		subscribeToAllJobs(jobs, this)
	}

	_onTgDone(tgVal: unknown, tg: Tg) {
		const { _tg, val } = this

		if (tg._st & ANY_ERR_OR_CANCOK) {
			addErrorToJobVal(this, tgVal as Err)
			unLinkFromAllTargets(this)
			this._st |= DONE
			notifyObservers(this, this.val)
			return
		}

		val.push(tgVal as T)

		if (!this._tg) {
			this._st |= DONE
			notifyObservers(this, val)
			return
		}
	}

	_execFail(tgVal: unknown) {
		// todo
}












/*
- Returns an array of the settled values of the passed-in jobs,
	ie, it waits for all to settle.
- Returns an empty array if the passed-in array in empty.
 */
export function all<Jobs extends Job<unknown>[]>(...jobs: Jobs) {
	if (jobs.length === 0) {
		return []
	}
	const observer = new All<NotErrs<Jobs[number]["val"]>>()
	subscribeToAllJobs(jobs, observer)
	return observer
}

class All<OkVals> extends JobBase<OkVals[]> {
	_nm = "all"
	val: OkVals[] = []

	_onTgDone(tgVal: unknown, tg: Job) {
		const { _tg, val } = this

		if (tg._st & ANY_ERR_OR_CANCOK) {
			addErrorToJobVal(this, tgVal as _Err)
			// unsubscribe from rest of jobs
			for (let link = _tg; link !== EMPTY_LINK; link = link.nA) {
				unlinkObAndTg(link)
			}
			this._st |= DONE
			notifyObservers(this, this.val)
			return
		}

		val.push(tgVal as OkVals)

		if (_tg === EMPTY_LINK) {
			this._st |= DONE
			notifyObservers(this, val)
			return
		}
	}
}


/*
- Returns the settled value of the first job that settles.
- The rest are cancelled.
- Settles with Error if passed-in array is empty.
 */
export function first<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

	return go(function* _first() {

		if (jobs.length === 0) {
			return userErrCtor("EmptyArguments", "first")
		}

		const ev = Ev()
		for (const j of jobs) {
			j._onDone(j => ev.emit(j))
		}

		const job = (yield ev.wait) as Job
		yield cancel(jobs)
		return job.val as NotErrs<Jobs[number]["val"]>
	})
}


/*
- Returns the settled value of the first job that settles successfully.
- The rest are cancelled.
- The jobs that failed are ignored.
- Settles with Error if all jobs fail.
- Settles with Error if passed-in array is empty.
 */
export function firstOK<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

	return go(function* _firstOK() {

		if (jobs.length === 0) {
			return userErrCtor("EmptyArguments", "firstOK")
		}

		const ev = Ev()
		for (const j of jobs) {
			j._onDone(j => ev.emit(j))
		}

		let inFlight = jobs.length
		while (inFlight--) {
			const job = (yield ev.wait) as Job
			if (job.failed) {
				continue
			}
			yield cancel(jobs)
			return job.val as NotErrs<Jobs[number]["val"]>
		}

		return userErrCtor("AllJobsFailed", "firstOK")
	})
}


//* *************************  JobSelect *********************************** *//











/* **********  newJob  ********** */

const dummyGen = (function* dummyGenFn() {})()

export function newJob<Ret = unknown, Errs = ECancOK |  | __Err>(jobName = "") {
	return new Job<Ret, Errs | ECancOK |  | __Err>(dummyGen, jobName)
}



//* **********  Promise to Job  ********** *//

export function promToJob<T>(p: Promise<T>) {
	const job = newJob<T, E<"PromiseRejected">>()

	p.then(
		ok => job.settle(ok),
		e => job.settle(userErrCtor("PromiseRejected", "fromProm", "", e))
	)

	return job
}

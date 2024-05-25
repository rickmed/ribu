import { Job, me, PARKED, cancel, go, type NotErrs } from "./job.mjs"
import { runningJob } from "./system.mjs"
import { E, ECancOK, ETimedOut, Err, RibuE } from "./errors.mjs"


//* **********  Job Combinators  ********** *//

/*
- Returns an array of the settled values of the passed-in jobs.
- If one job fails, the remaining jobs are cancelled and the job fails.
- Returns an empty array if the passed-in array in empty.
 */
export function allOneFail<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

	return go(function* _a1f() {

		let results: Array<NotErrs<Jobs[number]["val"]>> = []

		if (jobs.length === 0) {
			return results
		}

		me().steal(jobs)
		const ev = Ev()
		for (const j of jobs) {
			j._onDone(j => ev.emit(j))
		}

		let inFlight = jobs.length
		while (inFlight--) {
			const job = (yield ev.wait) as Job
			if (job.failed) {
				yield cancel(jobs)
				return E("AJobFailed", "allOneFail", "", job.val as RibuE)
			}
			results.push(job.val as typeof results[number])
		}

		return results
	})
}


/*
- Returns an array of the settled values of the passed-in jobs,
ie, it waits for all to settle.
- Returns an empty array if the passed-in array in empty.
 */
export function allDone<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

	return go(function* _ad() {

		let results: Array<NotErrs<Jobs[number]["val"]>> = []

		if (jobs.length === 0) {
			return results
		}

		me().steal(jobs)
		const ev = Ev()
		for (const j of jobs) {
			j._onDone(j => ev.emit(j))
		}

		let inFlight = jobs.length
		while (inFlight--) {
			const job = (yield ev.wait) as Job
			results.push(job.val as typeof results[number])
		}
		return results
	})
}


/*
- Returns the settled value of the first job that settles.
- The rest are cancelled.
- Settles with Error if passed-in array is empty.
 */
export function first<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

	return go(function* _fst() {

		if (jobs.length === 0) {
			return E("EmptyArguments", "first")
		}

		me().steal(jobs)
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
- Returns the settled value of the first job that settles _succesfully_.
- The rest are cancelled.
- The jobs that failed are ignored.
- Settles with Error if all jobs fail.
- Settles with Error if passed-in array is empty.
 */
export function firstOK<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

	return go(function* _fOK() {

		if (jobs.length === 0) {
			return E("EmptyArguments", "firstOK")
		}

		me().steal(jobs)
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

		return E("AllJobsFailed", "firstOK")
	})
}


class _Ev<T = unknown> {

	static Timeout = Symbol("to")

	waitingJob!: Job
	_timeout?: NodeJS.Timeout

	emit(val?: T) {
		if (this._timeout) {
			clearTimeout(this._timeout)
		}
		this.waitingJob._resume(val)
	}

	timeout(ms: number): typeof PARKED {
		const job = runningJob()
		this._timeout = setTimeout(() => {
			job._resume(_Ev.Timeout)
		}, ms)
		return PARKED
	}

	get wait(): typeof PARKED {
		this.waitingJob = runningJob()
		return PARKED
	}
}

export function Ev<T>() {
	return new _Ev<T>()
}



/* **********  newJob  ********** */

const dummyGen = (function* dummyGenFn() {})()

export function newJob<Ret = unknown, Errs = ECancOK | ETimedOut | Err>(jobName = "") {
	return new Job<Ret, Errs | ECancOK | ETimedOut | Err>(dummyGen, jobName)
}



//* **********  Promise to Job  ********** *//

export function fromProm<T>(p: Promise<T>) {
	const job = newJob<T, E<"PromiseRejected">>()

	p.then(
		ok => job.settle(ok),
		e => job.settle(E("PromiseRejected", "fromProm", "", e))
	)

	return job
}

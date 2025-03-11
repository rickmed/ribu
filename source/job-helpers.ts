import { DONE, Job, iter, State, cancel, go, onEnd, type NotErrs, iterRes } from "./job.ts"
import { sys } from "./shared.ts"
import { E, ECancOK, ETimedOut, Err, RibuE } from "./errors.ts"
import { TIMEOUT } from "dns"
import { sleep } from "./timers.ts"
import { Queue } from "./linked-lists.ts"
import { Ch, Chan } from "./channel.ts"
import { EMPTY_LINK, Link } from "./shared.ts"


//* **********  Job Combinators  ********** *//

/*
- Returns an array of the settled values of the passed-in jobs.
- If one job fails, it returns Error (fails callerJob if not using .err)
- Returns an empty array if the passed-in array in empty.
 */
export function allOrErr<Jobs extends Job<unknown>[]>(...jobs: Jobs) {
	return go(function* _allOrErr() {
		let results: Array<NotErrs<Jobs[number]["val"]>> = []
		let inflight = jobs.length
		if (inflight === 0) {
			return results
		}

		const jobsDone = observe(jobs)

		while (inflight > 0) {
			const job = yield* jobsDone
			inflight--
			if (job.failed) {
				yield* cancel(jobs)
				return E("AJobFailed", "allOrErr", "", job.val as RibuE)
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
export function all<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

	return go(function* _all() {

		let results: Array<NotErrs<Jobs[number]["val"]>> = []

		if (jobs.length === 0) {
			return results
		}

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

	return go(function* _first() {

		if (jobs.length === 0) {
			return E("EmptyArguments", "first")
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
			return E("EmptyArguments", "firstOK")
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

		return E("AllJobsFailed", "firstOK")
	})
}


function observe(jobs: Job[]) {
	return new ObserveSelectJobs(jobs)
}

class ObserveSelectJobs {
	callerJob = sys.runningJob

	constructor(jobs: Job[]) {
		const len = jobs.length
		for (let i = 0; i < len; i++) {
			// link job to this
		}
	}

	_onTgDone(job: Job) {
		// resume caller
	}
}













/* **********  newJob  ********** */

const dummyGen = (function* dummyGenFn() {})()

export function newJob<Ret = unknown, Errs = ECancOK | ETimedOut | Err>(jobName = "") {
	return new Job<Ret, Errs | ECancOK | ETimedOut | Err>(dummyGen, jobName)
}



//* **********  Promise to Job  ********** *//

export function promToJob<T>(p: Promise<T>) {
	const job = newJob<T, E<"PromiseRejected">>()

	p.then(
		ok => job.settle(ok),
		e => job.settle(E("PromiseRejected", "fromProm", "", e))
	)

	return job
}





/* **************************************************************** */


function cancel(jobs: Job[]) {
	const ctx = new CancelManager()
	for (const job of jobs) {
		// start cancelling the job and notifies result back to ctx
		cancelJob(job, ctx)
	}

	return ctx
}


class CancelAll {

	_state: -1 | State.DONE = -1
	targets: Job[]
	waitingJobsCount: number
	observer = sys.runningJob
	ObservedJobsErrors: Err[] | undefined

	constructor(jobs: Job[]) {
		this.targets = jobs
		this.waitingJobsCount = jobs.length
	}

	onObservedDone(observed: Selectable) {
		this.waitingJobsCount--
		if (this.waitingJobsCount === 0) {
			this._state = DONE
			this.observer.onObservedDone()
		}
	}

	removeFromObservers(observer: Observer) {
		for (const target of this.targets) {
			target.removeObserver(observer)
		}
	}

	// iterator method that behaves like .$
}
























/* **************************** CANCEL ALL ******************************** */

/* job.cance() implementation:

	const cancelJob = job.cancel()  // starts side effect of triggering child.cancel() (then onEnds)
	yield* cancelJob  // subscribe to result (cancel)
	cancel.cancel()  // noop (job is already in CANCELLING state)
*/

function cancelAll(jobs: Job[]) {
	const res = Ch()
	const onInnerJobCancel = Ch()
	let waiting = jobs.length

	for (const job of jobs) {
		go(function* () {
			const res = yield* job.cancel()
			yield* onInnerJobCancel.put(res)
			waiting--
		})
	}

	return go(function* () {

		let errors = []

		while (waiting > 0) {
			const res = yield* onInnerJobCancel.rec
			waiting--
			if (res instanceof Error) {
				errors.push(res)
			}
		}

		return errors.length > 0 ? errors : ECancOK
	})

}



/* Todo Optimize timer */

function timer(ms: number) {
	const ch = Ch<TIMEOUT>()
	const timeout = setTimeout(() => ch.enQ(TIMEOUT), ms)
	return go(function* _timeout() {
		onEnd(() => clearTimeout(timeout))
		yield* ch.rec
		return TIMEOUT
	})
}

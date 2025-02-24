import { DONE, Job, theIterator, State, cancel, go, onEnd, type NotErrs, theIterResult } from "./job.ts"
import { runningJob } from "./system.ts"
import { E, ECancOK, ETimedOut, Err, RibuE } from "./errors.ts"
import { TIMEOUT } from "dns"
import { sleep } from "./timers.ts"
import { Queue } from "./data-structures.ts"
import { Chan } from "./channel.ts"


//* **********  Job Combinators  ********** *//

/*
- Returns an array of the settled values of the passed-in jobs.
- If one job fails, it returns Error (fails callerJob if not using .err)
- Returns an empty array if the passed-in array in empty.
 */
export function allOrErr<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

	return go(function* _allOrErr() {

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
			if (job.failed) {
				yield cancel(jobs)
				return E("AJobFailed", "allOrErr", "", job.val as RibuE)
			}
			results.push(job.val as typeof results[number])
		}

		return results
	})
}



export function allOrErr2<Jobs extends Job<unknown>[]>(...jobs: Jobs) {
}


/* allOrErr

- Doesn't support allOrErr2(job1, job2).cancel()
	const res = yield* allOrErr(job1, job2).err
	if (res instanceof Error) {
		yield* cancel(jobs)
	}


- Supports only one observer

	const allOrErrObj = allOrErr(job1, job2)
	yield* allOrErrObj
	yield* allOrErrObj  // this throws


*/


class allOrErr2_ {

	private result: Array<NotErrs<Jobs[number]["val"]>> = []
	private errorResult?: E<"AJobFailed">
	private inFlight: number
	private observer?: Job

	constructor(jobs: Job[]) {
		this.inFlight = jobs.length
		for (const job of jobs) {
			jobs.addObserver(this)
		}
	}

	onObservableDone(job: Job) {
		if (job.failed) {
			const err = E("AJobFailed", "allOrErr", "", job.val as RibuE)
			for (const observable of this.observables) {
				observable.removeObserver(this)
			}
			this.errorResult = err
			this.observer?.onObservableDone(err)
			return
		}
		this.inFlight--
		const { result, inFlight } = this
		result.push(job.val as typeof result[number])
		if (inFlight === 0) {
			this.observer?.onObservableDone(results)
		}
	}

	[Symbol.iterator]() {
		if (this.errorResult || this.inFlight === 0) {
			// unblock caller inmediately
		}


	}

	get err() {
		sys.runningJob.__state = State.PARKED_END_IF_ERR
		return this
	}

	get val() {
		return this.errorResult ?? this.result
	}
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


/* ContinueAfter_ is Select !!

- Select's role is not to cancel anything.

- callerJob is cancelled at const res =  yield* select(job1, job2, ch1)
	it will cancel its other children and waiting for their cancel result

	SOLUTION:
		remove as observer from jobs, but not from channels
		channels skip resuming if callerJob.state !== blocked
*/


/*
	If channel has queued sending msgs/jobs, it should resume callerJob immediately
	Same if job is done
*/

type Observer = Job

/*
- Select in a loop works efficiently:

	const jobsList = [job1, job2, ch1]
	let waiting = jobsList.length

	const selectObj = select(...jobsList)

	while (waiting > 0) {
		const res = yield* selectObj
		waiting--
		// do whatever with res
	}



* default case (return DEFAULT SYMBOL from yield* when no one is ready)
* Need an internal queue of ready observables for fairness


* There could be max 1 observer (if another Job calls yield* selectObj, it throws)

*/

const NONE_READY = Symbol("N_R")

export class Select {

	observer?: Observer
	readySelectables?: Selectable | Queue<Selectable>
	private _nonBlocking = false

	constructor(selectables: Selectable[]) {
		for (const selectable of selectables) {
			if (selectable.isReady()) {
				const { readySelectables } = this
				if (readySelectables) {
					if (readySelectables instanceof Queue) {
						readySelectables.enQ(selectable)
					} else {
						this.readySelectables = new Queue<Selectable>().enQ(readySelectables)
					}
				}
			}
			else {  // selectable is not ready
				selectable.addObserver(this)
			}
		}
	}

	onObservableDone(val: unknown) {
		const {observer} = this
		if (observer) {
			observer.onObservableDone(val)
		}
	}

	addObserver(observer: Observer) {

	}

	removeObserver(observer: Observer) {
		// remove observer here
	}

	[Symbol.iterator]() {
		const { _nonBlocking, readySelectables } = this

		// todo, optimization: change instance of Queue to in operator
		const dontHaveReadySelectable = readySelectables === undefined || (readySelectables instanceof Queue && !readySelectables.isEmpty)

		if (dontHaveReadySelectable) {
			if (!_nonBlocking) {
				this.observer = sys.runningJob
				theIterResult.done = false
			}
			else {
				theIterResult.done = true
				theIterResult.value = NONE_READY
			}
		}

		else {  // Selectable(s) ready
			const selectableReady = isSelectable(readySelectables) ? readySelectables : readySelectables.deQ()
			theIterResult.done = true
			// should return job or job.val??
			// if its channel, how to get value?
			theIterResult.value = selectableReady
		}

		return theIterator
	}

	// todo: withDefault should return a Select
	nonBlocking() {
		this._nonBlocking = true
		return this
	}
}

type Selectable = Job | Chan

function isSelectable(maybeSelectable: NonNullable<unknown>): maybeSelectable is Selectable {
	if (typeof maybeSelectable === "object" && Symbol("$isSelectable") in maybeSelectable) {
		return true
	}
	return false
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

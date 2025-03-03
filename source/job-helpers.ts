import { DONE, Job, iterator, State, cancel, go, onEnd, type NotErrs, iterRes } from "./job.ts"
import { runningJob, sys } from "./system.ts"
import { E, ECancOK, ETimedOut, Err, RibuE } from "./errors.ts"
import { TIMEOUT } from "dns"
import { sleep } from "./timers.ts"
import { Queue } from "./linked-lists.ts"
import { Ch, Chan } from "./channel.ts"


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





/* Subscriptions architecture

** Job: blocked/subscribed to one job/Ch/Select
** Job: subscribed to many children (awaiting if done or cancelled)

This supports O1 many-many subscriptions (O: Observer, N: Notifier, conn: Connection):

	job.connHead

	1) Observer makes its own LL and inserts itself into all target's LL

		for target of targets:

			// make my own subscription LL

			const conn = {
				Ob: Job | Ch,
				pNt: prevSubObj,      // keep in function scope
				nNt: null,            // next moves towards tail
				pOb: null,
				nOb: null,
			}

			prevSubObj.nextSub = subscriptionObj

			// insert subscriptionObj into target's LL tail:

			const targetTail = target.obsTail
			if (targetTail != null) {
				targetTail.nextWatcher = subscriptionObj
				subscriptionObj.prevWatcher = targetTail
			}
			else {
				targetTail.nextWatcher = subscriptionObj
				subscriptionObj.prevWatcher = targetTail
			}

			target.obsTail = subscriptionObj

	2) When target is done (iterate from .obsHead)

		const { obsHead } = this
		if (obsHead != null) {

			// remove conn in notifier
			obsHead.prevOb.nextOb = obsHead.nextOb
			obsHead.nextOb.prevOb = obsHead.prevOb

			// remove conn in observer


			// notify Ob
			sys.targetJustDone = this
			obsHead.owner.onDone(val)
		}


	3) Obs can unsubscribe from all targets by just iterating over its
		.obsHead LL and removing nodes from all targets LL
		when its cancelled or a target is done.


** jobs._childs: How to use LL?
	- child needs to remove itself from parent's LL when done
		but when done, parent doesn't need to be resumed (parent.onDone())
	- child could also have observers that DO need to be notified when done (await child)

		So maybe a conn.nfy = boolean

	very cool since I just update conn.{p,n}N
	so I if job is cancelled I can mutate/transition all childs nodes conn objects
		so that notifier can notify back when done
	Can transition from normal run -> awaiting for childs -> cancelling childs


** onEnds list: Can reuse job.connHead (and nodes)
	- Needs to be executed Last In First Out
		- Now, all nodes head conn.pNt = tailConn (this way I can iterate from tail to head)


** Ch:
	Needs  dequeu <= []-[]-[] <= queue
		- so if ch.conn: head, need head.prevOb = tail
		- when iterating, instead of checking if node.next = null, check if node.next === head
		- Adding is from head. Maybe, will check the other iteration algos.

**** All nodes need to be removed from ob LL when nt is done so conn is returned to pool

*/



















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

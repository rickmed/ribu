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
		if (inflight == 0) {
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

	_onNtDone(job: Job) {
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





/* Subscriptions architecture

** Job: blocked/subscribed to one job/Ch/Select
** Job: subscribed to many children (awaiting if done or cancelled)

This supports O1 many-many subscriptions (O: Observer, T: Target, conn: Connection):

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

			// remove conn in target
			obsHead.prevOb.nextOb = obsHead.nextOb
			obsHead.nextOb.prevOb = obsHead.prevOb

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
		so that target can notify back when done
	Can transition from normal run -> awaiting for childs -> cancelling childs


** onEnds list: Can reuse job.connHead (and nodes)
	- Needs to be executed Last In First Out
		- Now, all nodes head conn.pNt = tailConn (this way I can iterate from tail to head)


** Ch:
	Needs  dequeu <= []-[]-[] <= queue
		- so if ch.conn: head, need head.prevOb = tail
		- when iterating, instead of checking if node.next = null, check if node.next === head
		- Adding is from head. Maybe, will check the other iteration algos.

**** All nodes need to be removed from ob LL when tg is done so conn is returned to pool

*/



/* Select (Jobs)
const res = yield* select(ch1, ch2)

- check if any of the targets is "ready"
	- job is easy (when state is DONE)
	- ch when there's a putter (selecting put ops is not supported yet)

	- fairness: what if more than one is ready?
		- I think it should have an internal queue.
		- Put all ready targets in a queue.
		- When observer subscribes (yield*) dequeue

	- PROBLEM: on select return, it should unsub from all targets.
		- so it has no way to know at the next loop turn what was selected before

	- SOLUTION: make it channel-like
		- you construct it and then yield* the same object (like ch.rec)
			(could potential add targets dynamically)
		- QUESTION: how to dispose it? how are channels "disposed"?

			const data = yield* ch.rec
				when rec completes, callingJob is taken out of ch.receiverS LL
				so there's no push pointer and GC works (same with job is cancelled)

			- This should be the same for select

		- IMPLEMENTATION: is like a channel where putters can be Ch as well.
			- How are putters as ch same/different from putters as job?
				- Is ch.receivers is empty, jobs are added in .putters (and resumed then receiver arrives)
				- Select should be into ch.receivers and "resumed/notified" when a target have data.
					- if no receivers in select, ch should be put in select.putters
					- Problem is that job can be in only one .putters queue.
						- Let's say a job puts to targetCh1
						- targetCh1 has a selectObj in its .receivers
							mmmm I think select should just insert callingJob as .receiver in targetCh1


- if one ready, notify observer with val.
- unsub from all targets.
- needs to subscribe to all targets.


- needs to unsubscribe from all targets when cancelled

*/

/* const res = yield* select(ch1, ch2, job1, job2)

- subscribe to all targets

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

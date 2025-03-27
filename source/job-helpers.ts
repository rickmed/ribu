import { DONE, ANY_ERR_OR_CANCOK, addErrorToJobVal, cancel, go, me, addObserver, onEnd, type Job } from "./job.js"
import { Err } from "ribu"
import { freshLink, SYS_ITERATOR, iterRes, SysIterator, Link, sys } from "./system.js"
import { Ch, Chan } from "./channel.js"
import { sleep } from "./timers.js"

// todo: consider passing a timeout parameter

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
 */


type NotErrs<T> = Exclude<T, Error>

/** allOrErr()
 *  Returns an array of the  _successful_ settled values of the passed-in jobs.
 *  If one job fails (or is cancelled, even successfully), it fails.
 *  Fails also if the passed-in array is empty.
 */
export function allOrErr<T>(...jobs: Job<T>[]) {
	return go(_allOrErr, jobs)
}

function* _allOrErr<T>(jobs: Job<T>[]) {
	let jobsLen = jobs.length
	if (jobsLen === 0) {
		return Err("EmptyArguments", "allOrErr")
	}

	onEnd(function* () {
		yield* cancel(...jobs)
	})

	const jobDone = Ch<Job>()  // todo: use using instead
	const result: T[] = []
	onJobsDoneIntoChan(jobDone, jobs)

	while (jobsLen > 0) {
		const job = yield* jobDone.rec
		jobsLen--
		if (job.halted) {
			return Err("BadJob", "allOrErr")
		}
		result.push(job.val as T)
	}

	return result
}


// maybe provide an optional "internal" chanlike that let me know
// when any job I'm subscribed to is done, so I can unsub from it.
	// all jobs would be in my _tg (remember to unsub from all in cancelJob())


// ok I need a iterator thing



const EmptyArgsErr = userErrCtor("EmptyArgumentsErr")
export type EmptyArgsErr = typeof EmptyArgsErr















/*
- Returns an array of the settled values of the passed-in jobs,
	ie, it waits for all to settle.
- Returns an empty array if the passed-in array in empty.
 */
export function all<Jobs extends Job<unknown>[]>(...jobs: Jobs) {
	if (jobs.length === 0) {
		return []
	}
	const observer = new All<YielRet<Jobs[number]["val"]>>()
	onJobsDoneIntoChan(jobs, observer)
	return observer
}

class All<OkVals> extends Job<OkVals[]> {
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
	// what if first() is cancelled?
	// will run onEnds
	return go(function* _first() {

		onEnd(function* () {
			// unsub from rest of jobs here??
			yield* cancel(jobs)
		})

		if (jobs.length === 0) {
			return userErrCtor("EmptyArguments", "first")
		}

		const ev = Ev()
		for (const j of jobs) {
			j._onDone(j => ev.emit(j))
		}

		const job = (yield ev.wait) as Job
		// unsub from rest of jobs here
		return job.val as YielRet<Jobs[number]["val"]>
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
			return job.val as YielRet<Jobs[number]["val"]>
		}

		return userErrCtor("AllJobsFailed", "firstOK")
	})
}



function onTgJobDone(_: unknown, tg: Job, ch: Chan<Job>) {
	if (ch.notDone) {
		ch.enQ(tg)
	}
}

function onJobsDoneIntoChan(ch: Chan<Job>, jobs: Job<unknown>[]) {
	const len = jobs.length
	for (let i = 0; i < len; i++) {
		const tgJob = jobs[i]!
		if (tgJob._st & DONE) {
			if (ch.notDone) {
				ch.enQ(tgJob)
			}
		}
		else {
			const link = freshLink(onTgJobDone, ch)
			addObserver(tgJob, link)
		}
	}
}


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

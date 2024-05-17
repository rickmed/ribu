// @ts-nocheck
/* eslint-disable */
import { go } from "./job.mjs"

/* ownership is a PITA.

	So the idea is that you could use continue using (for nice error handling)
		const res = yield* raceJob().$
	ie, racejob() needs to return a new job
*/

// Provide these helpers (other helpers can be made natively for faster)
function first(...jobs: Job[]) {
	return go(function* () {
		me().steal(jobs)
		// errors?
		const res = yield* anyDone(jobs)  // res :: Union of jobs.res
		yield cancel(jobs)
		return res
	})
}

const res = race(file1Job, file2Job).val

// first(): first done  (cancel rest)
// firstOK(): first succesful  (cancel rest)
// allDone(): waits for all to be done  (collect results)
// all(): if one fails, rest are cancelled.

function allDone(jobs: Job[]) {
	return go(function _allDone() {
		me().steal(jobs)
		const res = yield anyDone(jobs)   // PROBLEM: ::res ??
		const nDoneJobs = jobs.length
		let results = []
		while (nDoneJobs > 0) {

		}
	})
}

function allDone(jobs: Job[]): Job[] {   // returns same job array
	const allDoneJob = new Job()  // need to type new Job
	allDoneJob.steal(jobs)
	const nDoneJobs = jobs.length
	let results = []
	for (const j of jobs) {
		j.onDone(doneJob => {
			nDoneJobs--

		})
	}
	return allDoneJob
}

/*** race(): returns the first resolved (cancel the others)  ********************

### jobs OWNERSHIP:

- race() needs to take ownership of passed jobs, otherwise it breaks composition.
Since both passed jobs and the job created/returned by race(jobs) are all equal childs of
the caller, if you race(jobs).cancel(), it wouldn't cancel the passed jobs

For example, race(race(...jobs1), race(...jobs2))

- race() needs to take ownership of the passed jobs so when you cancel
race(), the passed jobs are cancelled automatically. Works well bc no jobs
should be active after race() is done, regardless.


### todo: maybe put in Job class so: job1.race(job2)

### What if race1 is cancelled while cancelling losing jobs?
	childs will have 2 concurrent cancellation requests; in the one below, childs
	will notify when cancelling is done and raceJ.resolve(j.val) will run, but
	since raceJ is !parked, then nothing will happen after that.
*/
function race(jobs: Job[]) {

	const raceJob = new Job()

	raceJob.steal(jobs)

	for (const j of jobs) {
		j.onDone(j => {
			cancelAll(jobs, res => {
				raceJob.resolve(j.val)
			})
		})
	}
	return raceJob
}



/* ** HELPER FNs ***********************************/

/*** all(): waits for all to settle  *******************************************

Usage:
	const jobsArr = yield* all(MyJobs())).$
	then can filter the ones that errored|success|whatever

todo: improve types
*/
function all(pool: Pool<Job>) {
	let res = []
	return go(function* () {
		while (pool.count) {
			res.push(yield* pool.rec)
		}
		return res
	})
}




// CON: needs to instantiate jobDone(): +1 callback and classObj
function race3(jobs: Job[]) {
	return go(function* _race() {
		const done = jobDone(jobs)
		const winner = yield* done
		yield* cancel(jobs)  // cancelling a done job is noop
		// // todo: test if this is faster:
		// const inFlight = jobs.splice(jobs.indexOf(winner), 1)
		// yield* cancel(inFlight)
		return winner
	})
}


/* any(): returns the first succesful (cancel in-flight). If no succesfull,
	collect errors of failed ones.
*/
function any(pool: Pool<Job>) {
	return pool().go(function* () {
		if (!pool.count) {
			return Error("Some error")
		}
		let errors
		while (pool.count) {
			const winJob = yield* pool.rec
			if (!err(winJob.val)) {
				yield* pool.cancel().$
				return winJob
			}
			if (!errors) {errors = []}
			errors.push(winJob)
		}
		return errors
	})
}

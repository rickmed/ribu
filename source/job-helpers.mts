// @ts-nocheck
/* eslint-disable */
import { go } from "./job.mjs"

/* ownership is a PITA.

	So the general idea is that you have a function that runs the computation when called

	So the idea is that you could use continue using (for nice error handling)
		const res = yield* raceJob().$
*/

// Provide these helpers (other helpers can be made natively for faster)
function userMadeRace(...jobs: Job[]) {
	// errors?
	return go(function* () {
		me().steal(jobs)
		const res = yield* anyDone(jobs)  // res :: Union of jobs.res
		yield cancellAll(jobs)
		return res
	})
}

const res = race(file1Job, file2Job).val






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

	raceJob.seize(jobs)

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




function cancellAll(jobs: Job[], cb: (res: "OK" | Error[]) => void) {
	let nJobs = jobs.length
	let errors: undefined | Error[]
	for (const j of jobs) {
		j.cancelCB(jb => {
			--nJobs
			if (err(jb.val)) {
				if (!errors) {errors = []}
				errors.push(jb.val)
			}
			if (nJobs === 0) {
				if (errors) {cb(errors)}
				else {cb("OK")}
			}
		})
	}
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

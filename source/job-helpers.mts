import { E, RibuE } from "./errors.mjs"
import { type Job, me, PARKED, cancel, go, type NotErrs } from "./job.mjs"
import { runningJob } from "./system.mjs"

/*
- Returns an array of the settled values of the passed-in jobs.
- If one job fails, the remaining jobs are cancelled and the job fails.
- Returns an empty array if the passed-in array in empty
 */
export function allOneFail<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

	return go(function* _a1f() {

		let results: Array<NotErrs<Jobs[number]["val"]>> = []

		if (jobs.length === 0) {
			return results
		}

		me().steal(jobs)
		const ev = new Ev()
		for (const j of jobs) {
			j._onDone(j => ev.emit(j))
		}

		// if job returns RibuE, what should ribu do?

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
- Returns an array of the resolved values of the passed jobs.
- Waits for all to settle.
- Returns an empty array if the passed-in array in empty.
 */
export function allDone<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

	return go(function* _ad() {

		let results: Array<NotErrs<Jobs[number]["val"]>> = []

		if (jobs.length === 0) {
			return results
		}

		me().steal(jobs)
		const ev = new Ev()
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
		const ev = new Ev()
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
- The jobs the failed are ignored
- Settles with Error if passed-in array is empty.
 */
export function firstOK<Jobs extends Job<unknown>[]>(...jobs: Jobs) {

	return go(function* _fOK() {

		if (jobs.length === 0) {
			return E("EmptyArguments", "firstOK")
		}

		me().steal(jobs)
		const ev = new Ev()
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







class Ev<CB_Aarg = unknown> {

	waitingJob!: Job

	emit(val: CB_Aarg) {
		this.waitingJob._resume(val)
	}

	get wait(): typeof PARKED {
		this.waitingJob = runningJob()
		return PARKED
	}
}


// Better names:

// first(): first done (cancel rest)
// firstOK(): first succesful (ignore failed, cancel rest)

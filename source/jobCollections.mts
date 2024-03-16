

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


/*** race(): returns the first resolved (cancel in-flight)  ********************

### jobs OWNERSHIP:
	- race() needs to take ownership of passed jobs, otherwise it breaks composition.
	- Since both passed jobs and the job race() creates are equal childs of
	the caller, if you want to cancel race(), you'd need to cancel all 3 of them.
	For example, race(race(...jobs1), race(...jobs2))
	- So, race() needs to take ownership of the passed jobs so when you cancel
	race(), the passed jobs are cancelled automatically. Works well bc no jobs
	should be active after race() is done, regardless.

### todo: maybe put in Job class so: job1.race(job2)

### CONTINUE: I don't think I need additional cancelling logic:
- If raceJob is cancelled I'd need to prevent jobs to call the onDoneCB.
- If child is cancelled, genFn will be stopped, but then will run observers'
CB with ECancelled; below, it will cancelAll (noop since already cancelled)
and resolve race1Job
	- OPTIONS:
		1) Job have ._observing :: [observed, cb] (so you can call observed.unObserve(cb))
			PRO/CON: maybe a bit faster but + code/memory
		2) Let CBs run and have inside .resolve() "if (amDone) return"
		** Let's see if other resources need to be unobserved

### What if race1 is cancelled while cancelling losing jobs?
	childs will have 2 concurrent cancellation requests; in the one below, childs
	will notify when cancelling is done and raceJ.resolve(j.val) will run, but
	since raceJ is !parked, then nothing will happen after that.

*/
function race1(jobs: Job[]) {
	const raceJ = new Job()  // child of caller.
	steal(raceJ, jobs)  // take ownership (read above)
	for (const j of jobs) {
		j.onDone(j => {
			cancelAll(jobs, res => {  // cancelling a done job is noop
				raceJ.resolve(j.val)  // resolve needs to check if val is Error
			})
		})
	}
	return raceJ
}

function cancellAll(jobs: Job[], cb: (res: 'OK' | Error[]) => void) {
	let nJobs = jobs.length
	let errors: undefined | Error[];
	for (const j of jobs) {
		j.cancelCB(jb => {
			--nJobs
			if (err(jb.val)) {
				if (!errors) errors = []
				errors.push(jb.val)
			}
			if (nJobs === 0) {
				if (errors) cb(errors)
				else cb('OK')
			}
		})
	}
}


function race2(pool: Pool<Job>) {
	return pool().go(function* () {
		const winJob = yield* pool.rec
		yield* pool.cancel().$
		return winJob
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
		if (!pool.count) return Error("Some error")
		let errors
		while (pool.count) {
			const winJob = yield* pool.rec
			if (!err(winJob.val)) {
				yield* pool.cancel().$
				return winJob
			}
			if (!errors) errors = []
			errors.push(winJob)
		}
		return errors
	})
}

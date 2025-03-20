import { go } from "../source/job.js"
import { sleep } from "../source/timers.js"

export function* job0Deep(sleepMs: number) {
	if (sleepMs) {
		yield* sleep(sleepMs)
	}
}

export function* job1Deep(sleepMs: number) {
	if (sleepMs) {
		yield* sleep(sleepMs)
	}
	yield* go(job0Deep, sleepMs)
}

export function* job2Deep(sleepMs: number) {
	if (sleepMs) {
		yield* sleep(sleepMs)
	}
	yield* go(job1Deep, sleepMs)
}

export function* nSequentialJobs0Deep(nJobs: number, sleepMs = 0) {
	const done = "done"
	for (let i = 0; i < nJobs; i++) {
		yield* go(job0Deep, sleepMs)
	}
	return done
}

export async function nConcurrentJobsEach3Deep(count: number, sleepMs = 0) {
	// eslint-disable-next-line require-yield
	await go(function* parentJob() {
		for (let i = 0; i < count; i++) {
			go(job2Deep, sleepMs)
		}
	})
}

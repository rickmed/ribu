import { type Job } from "./job.mjs"

class System {
	deadline = 5000
	stack: Array<Job> = []
	targetJob!: Job
	cancelCallerJob!: Job
	cancelTargetJobs!: Job[]

	get running(): Job | undefined {
		return this.stack.at(-1)
	}
}

export const sys = new System()

export function runningJob() {
	return sys.running!
}


export let theIterResult = {
	done: false,
	value: 0 as unknown,
}


export const theIterator = {
	next() {
		const job = runningJob()
		if (job._state === "RUNNING") {
			theIterResult.done = true
			theIterResult.value = job._io
		}
		else {
			theIterResult.done = false
		}
		return theIterResult
	}
}

export const theIterable = {
	[Symbol.iterator]() {
		return theIterator
	}
}



/* Types */

export type TheIterable<V> = {
	[Symbol.iterator]: () => Iterator<unknown, V>
}

export type TheIterator<V> = Iterator<unknown, V>

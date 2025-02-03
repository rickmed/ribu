import { type Job } from "./job.ts"

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

import { Chan } from "./channel.ts"
import { type Job } from "./job.ts"

class System {
	#stack: Array<Job> = []  // todo: optimize to Linked List
	runningJob?: Job
	selectableJustDone?: Chan | Job

	deadline = 5000
	targetJob!: Job
	cancelCallerJob!: Job
	cancelTargetJobs!: Job[]

	pushJob(job: Job) {
		this.runningJob = job
		this.#stack.push(job)
	}

	popJob() {
		return this.runningJob = this.#stack.pop()
	}
}

export const sys = new System()

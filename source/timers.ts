import { runningJob, setRunning, resumeJob, parkOrContinue, type Job, PARKED_SLEEP, PARK, setStateAndCtx } from "./job.ts"

export function sleep(ms: number) {
	return 1 as unknown as Generator<never, undefined, unknown>
}


export type Timeout = ReturnType<typeof setTimeout>


/*

** Notes:
	- A targetJob could only have one result (if cancelled, or finishes "normally")
		- It could be one event (+ payload to get targetJob._io)
		- currentState discriminates if handle on job is in normalBlock/Cancelling/Finishing.
	- => could SleepDone event be same as JobDone (PARK, PARK_$)?
		- SleepDone wants to resume job (it won't fire in any other state since any conflicting
		state will remove the setTimeout CB)


** Other Notes:
	- Make job.$, don't return ECancOK.
		- job.cancel() should continue fine when ECancOK.
	- make "yield* job" .$ and have .err to handle errors.
		- Maybe I need
*/



/* cancel job when blocked on yield* cancel(jobs) **

- start cancelling children
	- Continue letting cancelling jobs to finish cancelling
		* But children most likely are jobs already being cancelled.
			* So first check if any of the cancelling jobs
		* What if one fails? callerJob
	- Need to remove me from jobs observers
	- request cancel to child Jobs
- If they are my childs, I will "re-subsubscribe" so they let me know their (cancel) result.
- If they aren't my childs, someone else (presumimably) is waiting for them
	and will know their result; explicitly or via parent auto-waiting

cancel state inside the job would still need to create an additional object for context
	so I can create one here

now need to know how cancelling cancel() would work

*/


/* things that block/resume

	yield* sleep
		ON_CANCEL: clear timeout

	yield* job.$
	yield* job.err
		ON_CANCEL: ctx.removeObserver(this)

	yield* job.cancel
		- cancel children (run onEnds themselves)
			- this is async even if children onEnd is sync
		- then, run OnEnds.

	waiting for children

	yield* cancel(jobs)
		- just call cancelJob(job) on all jobs
		- this is like waiting on a job that can only .$

		=> what if "cancel_ev" comes while waiting here?
			=> what is behavior while yield* job.$?
			this means "i don't care about job result, bye", ie, remove callerJ from job.observers
			and move on with cancel behavior.
			- most likely jobs in cancellingJobs.targetJobs is similar to jobs in callerJobs.children
			- an in both we want their result.






Notes:
	** Need to cancelJob(job) (encapsulation)
		- now I waiting

	** Things job.cancel() need to dispose

		yield* ch.rec
		yield* ch.put()

		yield* job.$
		yield* job.err
			caller is in job.observers
			don't _really_ need to do anything
			bc when job notifies me back, it will be a noop.

		yield* sleep
			clear timer
			this could prevent the nodejs process from exiting, so need to clear

		yield* cancel(jobs)
			don't _really_ need to do anything
			bc when cancelmanager notifies me back, it will be a noop.

		yield* allOrFail(jobs) ??
			same beheavior as CancelAllManager

 */

/*
	endProtocol:
		- wait for children
		- run OnEnds.
*/
//

async function getData(): Promise<string> {
	return "some data"
}

async function main() {
	// This will trigger an ESLint error because getData returns a Promise
	// but it's being awaited directly without being called
	await getData

	// This would be correct:
	// await getData()
}

import { resumeJob, PARKED_SLEEP, Job } from "./job.js"
import { SYS_ITERABLE, SYS_ITERABLE, ensurePreviousYieldAndSetCallerJobNextSt, iterRes, sys } from "./system.js"

export function sleep(ms: number) {
	ensurePreviousYieldAndSetCallerJobNextSt(PARKED_SLEEP, "sleep")
	let callerJob = sys.runningJob
	callerJob._tm = setTimeout(timeOutCB, ms, callerJob)
	iterRes.done = false
	return SYS_ITERABLE as SYS_ITERABLE<undefined>
}

function timeOutCB(callerJob: Job) {
	resumeJob(callerJob)
}

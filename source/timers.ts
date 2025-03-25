import { resumeJob, PARKED_SLEEP, Job } from "./job.js"
import { _Iterable, iterable, ensurePreviousYieldAndSetCallerJobNextSt, iterRes, sys } from "./system.js"

export function sleep(ms: number) {
	ensurePreviousYieldAndSetCallerJobNextSt(PARKED_SLEEP, "sleep")
	let callerJob = sys.runningJob
	callerJob._tm = setTimeout(timeOutCB, ms, callerJob)
	callerJob._st |= PARKED_SLEEP
	iterRes.done = false
	return iterable as _Iterable<undefined>
}

function timeOutCB(callerJob: Job) {
	resumeJob(callerJob)
}

import { resumeJob, PARKED_SLEEP, Job } from "./job.js"
import { _Iterable, sysIterable, ensurePreviousYieldAndSetCallerJobNextSt, iterRes, sys } from "./system.js"

export function sleep(ms: number) {
	ensurePreviousYieldAndSetCallerJobNextSt(PARKED_SLEEP, "sleep")
	let callerJob = sys.runningJob
	callerJob._tm = setTimeout(timeOutCB, ms, callerJob)
	iterRes.done = false
	return sysIterable as _Iterable<undefined>
}

function timeOutCB(callerJob: Job) {
	resumeJob(callerJob)
}

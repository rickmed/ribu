import { resumeJob, PARKED_SLEEP, _Job } from "./job.js"
import { SYS_ITERABLE, type SysIterable, ensurePreviousYieldAndSetCallerJobNextSt, iterRes, sys } from "./system.js"

export function sleep(ms: number) {
	ensurePreviousYieldAndSetCallerJobNextSt(PARKED_SLEEP, "sleep")
	let callerJob = sys.runningJob
	callerJob._tm = setTimeout(timeOutCB, ms, callerJob)
	iterRes.done = false
	return SYS_ITERABLE as SysIterable<undefined>
}

function timeOutCB(callerJob: _Job) {
	resumeJob(callerJob)
}

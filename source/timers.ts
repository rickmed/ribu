import { resumeJob, PARKED_SLEEP, _Job } from "./job.js"
import { SYS_ITERABLE, type SysIterable, iterRes, sys } from "./system.js"

export function sleep(ms: number) {
	const callerJob_m = sys.runningJob
	callerJob_m._st |= PARKED_SLEEP
	callerJob_m._tm = setTimeout(timeOutCB, ms, callerJob_m)
	iterRes.done = false
	return SYS_ITERABLE as SysIterable<void>
}

function timeOutCB(callerJob: _Job) {
	resumeJob(callerJob)
}
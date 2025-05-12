import { resumeJob, PARKED_SLEEP, _Job, PARKED } from "./job.js"
import { SYS_ITERABLE, type SysIterable, iterRes, sys, throwNotYielded } from "./system.js"

export function sleep(ms: number) {
	const callerJob_m = sys.runningJob
	if (callerJob_m._st & PARKED) {
		throwNotYielded("sleep")
	}
	callerJob_m._tm = setTimeout(timeOutCB, ms, callerJob_m)
	iterRes.done = false
	callerJob_m._st |= PARKED_SLEEP
	return SYS_ITERABLE as SysIterable<void>
}

function timeOutCB(callerJob: _Job) {
	resumeJob(callerJob)
}
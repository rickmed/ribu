import { theiterable } from "./system.ts"
import { resumeJob, PARKED_SLEEP, Job } from "./job.ts"
import { Link, Ob, Tg, Yieldable, IterRes, iterRes } from "./system.ts"

/*  let's do all yield*

 there's only one iterator that dispatches to yieldables execYield(),
 they mutates iterRes to block/resume the callerJob.

 yieldables blocks job by mutating iterRes.done: false

 or if want to resume job immediately, set iterRes.done: true and iterRes.value

 when yieldable wants to resumeJob, it needs to
 mutate iterRes.done: true and iterRes.value
 and call resumeJob() which will call .next() on the remembered iterator

*/


let _ms = 0

const yieldable: Yieldable = {
	nm: "sleep",
	execYield(callerJob: Job, iterRes: IterRes) {
		callerJob._st |= PARKED_SLEEP
		callerJob._tg = setTimeout(timeOutCB, _ms, callerJob) as unknown as Link<Ob, Tg>
		iterRes.done = false
	}
}

export function sleep(ms: number) {
	_ms = ms
	return theiterable<never>(yieldable)
}

export function cancelSleep(job: Job, _clearTimeout = true) {
	job._st &= ~PARKED_SLEEP
	if (_clearTimeout) {
		clearTimeout(job._tg as unknown as NodeJS.Timeout)
	}
	job._tg = null
}

function timeOutCB(callerJob: Job) {
	cancelSleep(callerJob, false)
	iterRes.done = true
	resumeJob(callerJob)
}

import { freshLink, sysIterable, Link, Ob, Tg, Yieldable, IterRes, disposeLink, _Iterable, iterable, sys, SLEEP_OP } from "./system.js"
import { resumeJob, PARKED_SLEEP, Job, addTgAsHead, popTgHead } from "./job.js"

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
		const timeout = setTimeout(timeOutCB, _ms, callerJob) as unknown as Link<Ob, Tg>
		const link = freshLink(callerJob, timeout) as unknown as Link<Ob, Tg>
		addTgAsHead(callerJob, link)
		iterRes.done = false
	}
}

export function sleep(ms: number) {
	_ms = ms
	sys.yieldOpStr = SLEEP_OP
	return iterable as _Iterable<never>
}

export function cancelSleep(job: Job, _clearTimeout = true) {
	if (_clearTimeout) {
		clearTimeout(job._tg.b as unknown as NodeJS.Timeout)
	}
	disposeLink(popTgHead(job))
}

function timeOutCB(callerJob: Job) {
	cancelSleep(callerJob, false)
	resumeJob(callerJob)
}

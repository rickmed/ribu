import { resumeJob, PARKED_SLEEP } from "./job.ts"
import { Link, sys, Ob, Tg } from "./shared.ts"

export function sleep(ms: number) {
	let callerJob = sys.runningJob
	callerJob._st |= PARKED_SLEEP
	callerJob._tg = setTimeout(() => {
		callerJob._st &= ~PARKED_SLEEP
		callerJob._tg = null
		resumeJob(callerJob)
	}, ms) as unknown as Link<Ob, Tg>
}

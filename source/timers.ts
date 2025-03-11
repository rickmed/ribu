import { resumeJob, PARKED_SLEEP, YIELD } from "./job.ts"
import { Link, sys, Ob, Tg, EMPTY_LINK } from "./shared.ts"

export function sleep(ms: number) {
	let job = sys.runningJob
	job._st |= PARKED_SLEEP
	job._tg = setTimeout(() => {
		job._st &= ~PARKED_SLEEP
		job._tg = EMPTY_LINK as Link<Ob, Tg>
		resumeJob(job)
	}, ms) as unknown as Link<Ob, Tg>
	return YIELD
}

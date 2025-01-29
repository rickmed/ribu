import { PARKED } from "./job.js"
import { runningJob } from "./system.js"

/* todo, optimization:
	try remove _resume() from class into a stand-alone function
	caller._sleepTO = setTimeout(_resume, ms, caller)
*/
export function sleep(ms: number): typeof PARKED {
	let caller = runningJob()
	caller._sleepTO = setTimeout(function _timeout() {
		caller._resume()
	}, ms)

	return PARKED
}

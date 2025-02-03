import { runningJob } from "./system.ts"

/* todo, optimization:
	try remove _resume() from class into a stand-alone function
	caller._sleepTO = setTimeout(_resume, ms, caller)
*/
export function sleep(ms: number) {
	let caller = runningJob()
	caller._sleepTO = setTimeout(function _timeout() {
		caller._resume()
	}, ms)

	return caller._park()
}

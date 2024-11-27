import { PARKED } from "./job.js"
import { runningJob } from "./system.js"

export function sleep(ms: number): typeof PARKED {
	let caller = runningJob()

	caller._sleepTO = setTimeout(function to() {
		caller._resume()
	}, ms)

	return PARKED
}

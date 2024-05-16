import { PARKED } from "./job.mjs"
import { runningJob } from "./system.mjs"

export function sleep(ms: number): typeof PARKED {
	let caller = runningJob()

	caller._sleepTO = setTimeout(function to() {
		caller._resume()
	}, ms)

	return PARKED
}

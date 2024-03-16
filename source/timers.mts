import { Yield_Park, YIELD_PARK } from "./job.mjs"
import { runningJob } from "./system.mjs"

export function sleep(ms: number): Yield_Park {
	let caller = runningJob()

	caller._sleepTO = setTimeout(function to() {
		caller._resume()
	}, ms)

	return YIELD_PARK
}

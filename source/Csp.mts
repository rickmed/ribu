import { type Prc } from "./process.mjs"

export class Csp {
	defaultDeadline = 5000
	/**
	 * Where ribu the operations get the runningPrc to use if/when cancellation.
	 * It's a queue to solve the problem of the await continuation being called
	 * async when resolving the promises in chan.put/rec
	 */
	runningPrcS_m: Array<Prc> = []
}
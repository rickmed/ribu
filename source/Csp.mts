import { type Prc } from "./process.mjs"

export class Csp {
	defaultDeadline = 5000
	prcStack: Array<Prc> = []

	/** the "stackHead" when go() is running */
	runningPrc?: Prc = undefined
}
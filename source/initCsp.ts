import { Csp } from "./Csp.js"
import { type Prc } from "./process.js"

export const csp = new Csp()

export function getRunningPrc(): Prc {
	const runningPrc = csp.runningPrc
	if (!runningPrc) {
		throw Error(`ribu: no process running`)
	}
	return runningPrc
}
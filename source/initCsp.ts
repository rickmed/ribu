import { Csp } from "./Csp.js"
import { type Prc } from "./process.js"

export const csp = new Csp()

export function getRunningPrcOrThrow(onErrMsg: string): Prc {
	const runningPrc = csp.runningPrc
	if (!runningPrc) {
		throw Error(`ribu: ${onErrMsg}`)
	}
	return runningPrc
}
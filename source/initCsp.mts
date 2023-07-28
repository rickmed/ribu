import { Csp } from "./Csp.mjs"
import { type Prc } from "./process.mjs"

export const csp = new Csp()

export function getRunningPrcOrThrow(onErrMsg: string): Prc {
	const runningPrc = csp.runningPrc
	if (!runningPrc) {
		throw Error(`ribu: ${onErrMsg}`)
	}
	return runningPrc
}
import { Csp } from "./Csp.mjs"
import { type Prc } from "./process.mjs"

export const csp = new Csp()

export function getRunningPrc(onErrMsg: string): Prc {
	const runningPrc = csp.runningPrcS_m.pop()
	if (!runningPrc) {
		throw Error(`ribu: ${onErrMsg}`)
	}
	return runningPrc
}

import { type Prc } from "./process.js"
import { Ch } from "./channel.js"

type OpsAndVals = {
	sleep: number,
	chRec: Ch,
	chPut: Ch,
}

export class Csp {
	deadLn = 5000
	currentOp: keyof OpsAndVals = "sleep"  // dummy start value
	currentOpV: Ch<unknown> | number = 0  // idem
	prcStack: Array<Prc> = []

	get runningPrc() {
		const prc = this.prcStack.at(-1)
		if (!prc) {
			throw Error(`ribu: no process running`)
		}
		return prc
	}
}
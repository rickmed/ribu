import { run } from "./Prc.mjs"

export class Csp {

	defaultDeadline = 5000
	
	/** @type {Set<_Ribu.Prc>} */
	scheduledPrcS = new Set()

	/** @type {Array<_Ribu.Prc>} */
	prcStack = []

	runScheduledPrcS() {
		for (const prc of this.scheduledPrcS) {
			this.scheduledPrcS.delete(prc)
			run(prc)
		}
	}

	/** @param {_Ribu.Prc} prc */
	schedule(prc) {
		this.scheduledPrcS.add(prc)
	}

	get runningPrc() {
		return this.prcStack[this.prcStack.length - 1]
	}
}
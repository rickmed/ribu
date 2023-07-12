import { run, Prc } from "./Prc.mts"

export class Csp {

	defaultDeadline = 5000
	scheduledPrcS: Set<Prc> = new Set()
	prcStack: Array<Prc> = []

	runScheduledPrcS() {
		for (const prc of this.scheduledPrcS) {
			this.scheduledPrcS.delete(prc)
			run(prc)
		}
	}

	schedule(prc: Prc) {
		this.scheduledPrcS.add(prc)
	}

	get runningPrc() {
		return this.prcStack[this.prcStack.length - 1]
	}
}
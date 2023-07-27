import { run, type Prc } from "./process.mjs"

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

	get runningPrc(): Prc | undefined {
		return this.prcStack[this.prcStack.length - 1]
	}
}
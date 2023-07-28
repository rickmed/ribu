import { type Prc } from "./process.mjs"

export class Csp {

	defaultDeadline = 5000
	prcStack: Array<Prc> = []
	// scheduledPrcS: Set<Prc> = new Set()

	// runScheduledPrcS() {
	// 	/** Sets are iterated in add order so ok to delete while iterating */
	// 	for (const prc of this.scheduledPrcS) {
	// 		this.scheduledPrcS.delete(prc)
	// 		run(prc)
	// 	}
	// }

	// schedule(prc: Prc) {
	// 	this.scheduledPrcS.add(prc)
	// }

	get runningPrc() {
		return this.prcStack.at(-1)
	}
}
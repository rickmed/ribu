export class Csp {

	defaultDeadline = 3000
	#scheduledPrcS = new Set()

	/** @type {_Ribu.Prc | undefined} */
	runningPrc = undefined

	/** @param {number=} defaultDeadline */
	constructor(defaultDeadline) {
		if (defaultDeadline !== undefined) {
			this.defaultDeadline = defaultDeadline
		}
	}

	runScheduledPrcS() {
		for (const prc of this.#scheduledPrcS) {
			this.#scheduledPrcS.delete(prc)
			prc.run()
		}
	}

	/** @param {_Ribu.Prc} prc */
	schedule(prc) {
		this.#scheduledPrcS.add(prc)
	}
}
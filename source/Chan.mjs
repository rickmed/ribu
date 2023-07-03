import { ArrayQueue } from "./buffers.mjs"
import { YIELD_VAL } from "./Prc.mjs"


/**
 * @template TVal
 * @implements {_Ribu.Ch<TVal>}
 */
export class Chan {

	/** @type ArrayQueue<TVal> */
	#buffer

	/** @type ArrayQueue<_Ribu.Prc> */
	#waitingSenders = new ArrayQueue()

	/** @type ArrayQueue<_Ribu.Prc> */
	#waitingReceivers = new ArrayQueue()

	#csp

	/**
	 * @param {number} capacity
	 * @param {_Ribu.Csp} csp
	 */
	constructor(capacity, csp) {
		this.#csp = csp
		this.#buffer = new ArrayQueue(capacity)
	}

	/** @type {_Ribu.PutFn<TVal>} */
	put(msg) {

		const {runningPrc} = this.#csp

		if (runningPrc === undefined) {
			throw new Error(`can't put outside a process`)
		}

		const buffer = this.#buffer

		if (buffer.isFull) {
			this.#waitingSenders.push(runningPrc)
			runningPrc.setPark(msg)
			return YIELD_VAL
		}

		runningPrc.setResume()

		const waitingReceivers = this.#waitingReceivers
		if (!waitingReceivers.isEmpty) {

			// receivingPrc is not undefined, just checked
			const receivingPrc = /** @type {_Ribu.Prc} */ (this.#waitingReceivers.pull())

			// don't push msg in buffer, put in directly in process to resume
			receivingPrc.queueToRun(msg)
			return YIELD_VAL
		}

		// ok to coerce bc can't relate yield and .next() types either way
		buffer.push(/** @type {TVal} */(msg))
		return YIELD_VAL
	}

	/** @return {YIELD_VAL} */
	get rec() {

		const {runningPrc} = this.#csp

		if (runningPrc === undefined) {
			throw new Error(`can't receive outside a process`)
		}

		const buffer = this.#buffer

		if (buffer.isEmpty) {
			this.#waitingReceivers.push(runningPrc)
			runningPrc.setPark()
			return YIELD_VAL
		}

		runningPrc.setResume(buffer.pull())

		const waitingSenders = this.#waitingSenders
		if (!waitingSenders.isEmpty) {

			// cast is ok since senderPrc is not undefined, just checked with !isEmpty
			const senderPrc = /** @type {_Ribu.Prc} */ (waitingSenders.pull())
			buffer.push(/** @type {TVal} */ (senderPrc.pullOutMsg()))
			senderPrc.queueToRun()
		}

		return YIELD_VAL
	}
}

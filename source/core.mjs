import { ArrayQueue } from "./buffers.mjs"

/* === Core API ============================================================= */

/**
 * @param {CSP} csp
 * @returns {(gen_or_genFn: _Ribu.Gen_or_GenFn) => Process}
 */
export const go = (csp) =>

	function go(gen_or_genFn) {
		const gen = typeof gen_or_genFn === "function" ?
			gen_or_genFn() :
			gen_or_genFn

		const process = new Proc(gen, csp)
		process.run()
		return new Process(process)
	}


/**
 * @template TChanVal
 * @param {CSP} csp
 * @returns {(capacity?: number) => Chan<TChanVal>}
 */
export const Ch = (csp) =>
	function Ch(capacity = 1) {
		return new Chan(capacity, csp)
	}


/**
 * @param {_Ribu.SetTimeout} setTimeout
 * @param {CSP} csp
 * @returns {(ms: number) => _Ribu.Yield}
 */
export const wait = (setTimeout, csp) =>

	function wait(ms) {

		const procBeingRan = csp.runningProc

		setTimeout(() => {
			procBeingRan.setResume()
			procBeingRan.run()
		}, ms)

		procBeingRan.setPark()

		return YIELD
	}



/* === Chan ================================================================= */

/**
 * @template TVal
 */
export class Chan {

	/** @type ArrayQueue<TVal> */
	#buffer

	/** @type ArrayQueue<Proc> */
	#waitingSenders = new ArrayQueue()

	/** @type ArrayQueue<Proc> */
	#waitingReceivers = new ArrayQueue()

	#csp

	/**
	 * @param {number} capacity
	 * @param {CSP} csp
	 */
	constructor(capacity, csp) {
		this.#csp = csp
		this.#buffer = new ArrayQueue(capacity)
	}

	/** @param {TVal} msg */
	put(msg) {

		const { runningProc: currentProc } = this.#csp
		const buffer = this.#buffer

		if (buffer.isFull) {
			this.#waitingSenders.push(currentProc)
			currentProc.setPark(msg)
			return YIELD
		}

		currentProc.setResume()

		const waitingReceivers = this.#waitingReceivers
		if (!waitingReceivers.isEmpty) {

			// receivingProc is not undefined, just checked
			const receivingProc = /** @type {Proc} */ (this.#waitingReceivers.pull())

			// don't push msg in buffer, put in directly in process to resume
			receivingProc.queueToRun(msg)
			return YIELD
		}

		buffer.push(msg)
		return YIELD
	}

	get rec() {

		const { runningProc: currentProc } = this.#csp
		const buffer = this.#buffer

		if (buffer.isEmpty) {
			this.#waitingReceivers.push(currentProc)
			currentProc.setPark()
			return YIELD
		}

		currentProc.setResume(buffer.pull())

		const waitingSenders = this.#waitingSenders
		if (!waitingSenders.isEmpty) {

			// senderProc is not undefined, just checked
			const senderProc = /** @type {Proc} */ (waitingSenders.pull())
			buffer.push(senderProc.pullOutMsg())
			senderProc.queueToRun()
		}

		return YIELD
	}
}



/* === Process ============================================================== */

export class Process {

	#process

	/** @param {Proc} process */
	constructor(process) {
		this.#process = process
	}

	/** @todo */
	cancel() { }
}



/* === CSP ================================================================== */

export class CSP {

	#scheduledProcs = new Set()

	runningProc = /** @type {Proc} */ (/** @type {unknown} */ (undefined))

	runScheduledProcs() {
		for (const proc of this.#scheduledProcs) {
			this.#scheduledProcs.delete(proc)
			proc.run()
		}
	}

	/** @param {Proc} proc */
	schedule(proc) {
		this.#scheduledProcs.add(proc)
	}
}



/* === Proc (the generator manager) ========================================= */

export const YIELD = /** @type {const} */ (4632)

const PARK = 1
const RESUME = 2

/** @typedef { PARK | RESUME } State */

export class Proc {

	#gen
	/** @type {State} */
	#state = RESUME  // runs immediately

	/** @type {any} */
	#inOrOutMsg = undefined   // bc first gen.next(inOrOutMsg) is ignored
	#csp

	/**
	 * @param {Ribu.Gen} gen
	 * @param {CSP} csp
	 */
	constructor(gen, csp) {
		this.#csp = csp
		this.#gen = gen
	}

	run() {

		this.#csp.runningProc = this

		let gen_is_done = false
		while (!gen_is_done) {

			const state = this.#state

			if (state === PARK) {
				break
			}

			if (state === RESUME) {

				const { done, value } = this.#gen.next(this.#inOrOutMsg)

				if (done === true) {
					gen_is_done = true
					break
				}

				if (value === YIELD) {
					continue  // all ribu yieldables set the appropiate conditions to be checked in next loop
				}

				// yielded a promise
				if (typeof value?.then === "function") {
					const currentProc = this

					const promise = value

					promise.then(val => {
						currentProc.setResume(val)
						currentProc.run()
					}, err => {
						// @todo implement processes supervisors
						this.#gen.throw(err)
					})
					currentProc.setPark()
					break
				}

				// @todo: yields a launch of a process

				throw new Error(`can't yield something that is not a channel operation, wait, go() or a promise`)
			}
		}

		if (gen_is_done) {
			// @todo
		}

		this.#csp.runScheduledProcs()
	}

	pullOutMsg() {
		const outMsg = this.#inOrOutMsg
		this.#inOrOutMsg = undefined
		return outMsg
	}

	/** @type {(inOrOutMsg?: any) => void} */
	setResume(inOrOutMsg) {
		this.#state = RESUME
		this.#inOrOutMsg = inOrOutMsg
	}

	/** @type {(inOrOutMsg?: any) => void} */
	setPark(inOrOutMsg) {
		this.#state = PARK
		this.#inOrOutMsg = inOrOutMsg
	}

	/** @type {(inOrOutMsg?: any) => void} */
	queueToRun(inOrOutMsg) {
		this.setResume(inOrOutMsg)
		this.#csp.schedule(this)
	}
}

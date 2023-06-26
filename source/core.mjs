import { ArrayQueue } from "./buffers.mjs"
import { Ch, go } from "./ribu.mjs"

/* === Core API ============================================================= */

/**
 * @param {CSP} csp
 * @returns {(gen_or_genFn: _Ribu.Gen_or_GenFn) => Process}
 */
export const _go = (csp) =>

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
export const _Ch = (csp) =>
	function Ch(capacity = 1) {
		return new Chan(capacity, csp)
	}


/**
 * @param {_Ribu.SetTimeout} setTimeout
 * @param {CSP} csp
 * @returns {(ms: number) => _Ribu.Yield}
 */
export const _wait = (setTimeout, csp) =>

	function wait(ms) {

		const procBeingRan = csp.runningProc

		setTimeout(() => {
			procBeingRan.setResume()
			procBeingRan.run()
		}, ms)

		procBeingRan.setPark()

		return YIELD_VAL
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

	/** @param {TVal=} msg */
	put(msg) {

		const { runningProc: currentProc } = this.#csp
		const buffer = this.#buffer

		if (buffer.isFull) {
			this.#waitingSenders.push(currentProc)
			currentProc.setPark(msg)
			return YIELD_VAL
		}

		currentProc.setResume()

		const waitingReceivers = this.#waitingReceivers
		if (!waitingReceivers.isEmpty) {

			// receivingProc is not undefined, just checked
			const receivingProc = /** @type {Proc} */ (this.#waitingReceivers.pull())

			// don't push msg in buffer, put in directly in process to resume
			receivingProc.queueToRun(msg)
			return YIELD_VAL
		}

		// ok to coerce bc can't relate yield and .next() types either way
		buffer.push(/** @type {TVal} */ (msg))
		return YIELD_VAL
	}

	get rec() {

		const { runningProc: currentProc } = this.#csp
		const buffer = this.#buffer

		if (buffer.isEmpty) {
			this.#waitingReceivers.push(currentProc)
			currentProc.setPark()
			return YIELD_VAL
		}

		currentProc.setResume(buffer.pull())

		const waitingSenders = this.#waitingSenders
		if (!waitingSenders.isEmpty) {

			// cast is ok since senderProc is not undefined, just checked with !isEmpty
			const senderProc = /** @type {Proc} */ (waitingSenders.pull())
			buffer.push(senderProc.pullOutMsg())
			senderProc.queueToRun()
		}

		return YIELD_VAL
	}
}



/* === Process ============================================================== */

export class Process {

	#process

	/** @param {Proc} process */
	constructor(process) {
		this.#process = process
	}

	cancel() {
		const cancelDone = Ch()

		const proc = this.#process

		if (proc.state === IN_CANCEL) {
			go(function* voidCancelProc() {
				yield cancelDone.put()
			})
		}
		else {
			go(function* cancelProc() {
				/*
					* put proc in cancel state and run genFn.return()
					* in parallel, cancel its tracked resources:
						for all children procs (need)
				*/
				yield cancelDone.put()
			})

		}

		return cancelDone

		/*
			- need to wrap all tracked resources in a uniform .cancel() interface.
				- a plain promise can't be cancelled (but the return value would be ignored)
				- wait() needs to return an object with a .cancel() method which return a channel
				- so now a Ribu.Yield is a 4632 | Cancellable

			child procs (cancellable), channels (cancellable?), timeouts(), proms

			** ARE CHANNELS CANCELLABLE?? is there any cleanup to do??
				1) proc at "yield ch.put(msg)"
					- ie, proc.#outMsg = msg & ch.#waitingSenders = [proc]
						- I think ok bc eventually a proc will pullOut both of those
							and proc can be finally GC and msg will not be lost.
				2) proc at "yield ch.rec"
					- ie, ch.#waitingReceivers = [proc]
						- If I cancel proc, proc won't be GC until ch is GC.
						- Also, any proc will send to a proc that will never rec, ie,
							msg will be lost.
						- that is not much a problem, problem is if proc is cancelled, the internal
							sending of the msg may crash ribu (maybe??):
							- no. will be ok bc will call gen.next(msg)
								which will return done = true and get out of state machine interpreter


		"if you're the receiver, you should never close the channel bc a sender panics on ch.send()"

			- how to I cancel? need to genFn.return
				- for gen to go to clean-up phase


			- also need to check for the resources that this proc's "tracked resources"
				- idea is to run in parallel:
					* cancel/dispose of tracked resources:	child procs, channels, proms, timeouts
					* this.genFn finally{}:
						finally mostly likely will yield values (like proms) to dispose of async resources:


		*/

	}
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

export const YIELD_VAL = 4632

const IN_RUN = 1
const IN_CANCEL = 2
const PARK = 3
const RESUME = 4

/** @typedef { IN_RUN | IN_CANCEL } State */
/** @typedef { PARK | RESUME } ExecNext */

export class Proc {

	#gen

	// genFn is ran immediately
	/** @readonly @type {State} */
	state = IN_RUN
	/** @type {ExecNext} */
	#execNext = RESUME

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

			const exec = this.#execNext

			if (exec === PARK) {
				break
			}

			if (exec === RESUME) {

				const { done, value } = this.#gen.next(this.#inOrOutMsg)

				if (done === true) {
					gen_is_done = true
					break
				}

				if (value === YIELD_VAL) {
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
		this.#execNext = RESUME
		this.#inOrOutMsg = inOrOutMsg
	}

	/** @type {(inOrOutMsg?: any) => void} */
	setPark(inOrOutMsg) {
		this.#execNext = PARK
		this.#inOrOutMsg = inOrOutMsg
	}

	/** @type {(inOrOutMsg?: any) => void} */
	queueToRun(inOrOutMsg) {
		this.setResume(inOrOutMsg)
		this.#csp.schedule(this)
	}
}

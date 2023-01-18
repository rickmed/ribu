/** @template Val */
class ArrayQueue {

	constructor(capacity = Number.MAX_SAFE_INTEGER) {

      /** @private */
		this.capacity = capacity

      /** @private @type Array<Val> */
		this.array = []
	}

	get isEmpty() {
		return this.array.length === 0
	}
	get isFull() {
		return this.array.length === this.capacity
	}

	pull() {
		return this.array.pop()
	}

   /** @param {Val} x */
	push(x) {
		this.array.unshift(x)
	}
}

const q1 = new ArrayQueue()

/** @type Set<Process> */
let scheduledProcs = new Set()

function runScheduledProcs() {
	for (const proc of scheduledProcs) {
		scheduledProcs.delete(proc)
		proc.run()
	}
}


/** @type {Process} */
let currentProc

const RESUME = 1
const PARK = 2
const RIBU_YIELD_VAL = 4632

/** @template TYield, TReturn, TNext */
class Process {

	/** @param {Generator<TYield>} gen */
	constructor(gen) {

		/** @private @type {typeof gen}*/
		this.gen = gen

		this.execNext = RESUME
		this.transitMsg = undefined   // bc first gen.next(val) is ignored
	}

	run() {
		currentProc = this

		let gen_is_done = false
		while (true) {

			const execNext = this.execNext

			if (execNext === PARK) {
				break
			}
			if (execNext === RESUME) {
				const {done, value} = this.gen.next(this.transitMsg)

				// .done can absent. If so, means gen is not done
				if (done === undefined || done === true) {
					gen_is_done = true
					break
				}

				// a chan operation or sleep
				if (value === RIBU_YIELD_VAL) {
					continue  // since both place necessary context in proc for next loop
				}

				// a go() call
				if (value?.RIBU_YIELD_VAL) {
					// TODO
					continue
				}

				// yielded a promise
				if (typeof value?.then === "function") {
					const procBeingRan = currentProc

					/** @type Awaited<typeof value> */
					const promise = value

					promise.then(val => {
						procBeingRan.resume(val)
						procBeingRan.run()
					}, err => {
						// TODO
					})
					procBeingRan.park()
					break
				}

				throw new Error(`can't yield something that is not a channel operation, sleep, go() or a promise`)
			}
		}

		if (gen_is_done) {
			// TODO
		}

		runScheduledProcs()
	}

	// channel only calls park(), resume() or schedule()
	//
	pullTransitMsg() {
		const transitMsg = this.transitMsg
		this.transitMsg = undefined
		return transitMsg
	}
	resume(transitMsg) {
		this.execNext = RESUME
		this.transitMsg = transitMsg
	}
	park(transitMsg) {
		this.execNext = PARK
		this.transitMsg = transitMsg
	}
	schedule(transitMsg) {
		this.execNext = RESUME
		this.transitMsg = transitMsg
		scheduledProcs.add(this)
	}
}


export class Proc {

	/** @param {Process} process */
	constructor(process) {

		/** @private @type Process */
		this._process = process
	}

	/** @todo */
	cancel() {

	}
}


/** @template TVal */
export class Chan {

	/** @param {number} capacity */
	constructor(capacity) {

		/** @private @type ArrayQueue<TVal> */
		this.buffer = new ArrayQueue(capacity)

		/** @private @type ArrayQueue<Process> */
		this.waitingSenders = new ArrayQueue()

		/** @private @type ArrayQueue<Process> */
		this.waitingReceivers = new ArrayQueue()
	}

	/** @param {TVal} msg */
	put(msg) {

		if (this.buffer.isFull) {
			this.waitingSenders.push(currentProc)
			currentProc.park(msg)
			return RIBU_YIELD_VAL
		}

		// buffer is not full so current process can continue
		currentProc.resume()

		// if waiting receivers, put msg directly, no need to buffer
		if (!this.waitingReceivers.isEmpty) {
			const receivingProc = this.waitingReceivers.pull()
			receivingProc.schedule(msg)
			return RIBU_YIELD_VAL
		}

		this.buffer.push(msg)
		return RIBU_YIELD_VAL
	}
	rec() {

		const buffer = this.buffer

		if (buffer.isEmpty) {
			this.waitingReceivers.push(currentProc)
			currentProc.park()
			return RIBU_YIELD_VAL
		}

		const waitingSenders = this.waitingSenders
		if (!waitingSenders.isEmpty) {
			const senderProc = waitingSenders.pull()
			buffer.push(senderProc.pullTransitMsg())
			senderProc.schedule()
		}

		currentProc.resume(buffer.pull())
		return RIBU_YIELD_VAL
	}
}


/**
 * @param {import("./core").GoGen} gen_or_genFn
 * @returns {Proc}
 */
export function go(gen_or_genFn) {

	const gen = typeof gen_or_genFn === "function" ?
		gen_or_genFn() :
		gen_or_genFn

	const process = new Process(gen)
	process.run()
	return new Proc(process)
}

/**
 * @template Val
 * @returns {Chan<Val>}
 */
export function Ch(capacity = 100) {
	return new Chan(capacity)
}


/** @param {number} ms */
export function sleep(ms) {
	const procBeingRan = currentProc
	setTimeout(() => {
		procBeingRan.resume()
		procBeingRan.run()
	}, ms)
	procBeingRan.park()
	return RIBU_YIELD_VAL
}

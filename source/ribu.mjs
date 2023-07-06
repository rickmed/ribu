import { Prc, YIELD_VAL } from "./Prc.mjs"
import { Chan } from "./Chan.mjs"
import { Csp } from "./Csp.mjs"


/**
 * @template [TVal=undefined]
 * @typedef {Ribu.Ch<TVal>} Ch<TVal>
 */

/** @typedef {Ribu.Proc} Proc */
/** @typedef {_Ribu.Gen_or_GenFn} Gen_or_GenFn */
/**
 * @template {string} TconfKs
 * @typedef {_Ribu.Conf<TconfKs>} Conf<TconfKs>
 * */


const csp = new Csp()


/**
 * @template {string} TKs
 * @param {Gen_or_GenFn} gen_or_genFn
 * @param {Conf<TKs>=} conf
 * @returns {Proc & _Ribu.Ports<TKs>}
 */
export function go(gen_or_genFn, conf) {

	const gen = gen_or_genFn instanceof Function ? gen_or_genFn() :
		gen_or_genFn

	const deadline = /** @type {number=} */ (conf && ("deadline" in conf) ? conf.deadline : undefined)
	const prc = new Prc(gen, csp, deadline)

	/** @type {Proc} */
	const ProcPrototype = {
		done: prc.done,
		cancel() {
			// is not prc.cancel.bind.(prc) bc I don't want plain js users to accidentally
			// pass in a cancel deadline, which in important in Prc.cancel()
			return prc.cancel()
		}
	}

	const proc = Object.create(ProcPrototype)

	if (conf !== undefined) {
		for (const k in conf) {
			if (k === "deadline" || k === "cancel" || k === "done") continue
			const optsVal = conf[k]
			proc[k] = optsVal
		}
	}

	prc.run()
	return proc
}


/**
 * @type {(capacity?: number) => Ch}
 */
export function ch(capacity = 1) {
	const newch = new Chan(capacity, csp)
	return newch
}


/** @type {(ms: number) => YIELD_VAL | never} */
export function sleep(ms) {

	const procBeingRan = csp.runningPrc
	if (procBeingRan === undefined) {
		throw new Error(`ribu: can't call sleep outside a generator function`)
	}

	// @todo: not using yield down here is weird
	go(function* sleepPrc() {  // eslint-disable-line require-yield

		const timeoutID = setTimeout(() => {
			procBeingRan.setResume()
			procBeingRan.run()
		}, ms)

		onCancel(() => clearTimeout(timeoutID))
	})

	return YIELD_VAL
}


/** @type {(...procS: Proc[]) => Ch | never} */
export function done(...procS) {

	const allDone = ch()

	/** @type {Array<Ch>} */
	let doneChs
	if (procS.length === 0) {

		const { runningPrc } = csp

		if (runningPrc === undefined) {
			throw new Error(`ribu: can't call done without parameters and outside a generator function`)
		}

		const { $childS: $childPrcS } = runningPrc

		if ($childPrcS === undefined) {
			return allDone
		}

		const prcDoneChs = []
		for (const prc of $childPrcS) {
			prcDoneChs.push(prc.done)
		}
		doneChs = prcDoneChs
	}
	else {
		doneChs = procS.map(proc => proc.done)
	}


	go(function* _donePrc() {
		yield all(...doneChs).rec
		yield allDone.put()
	})

	return allDone
}


/** @type {(fn: _Ribu.GenFn | Function) => void} */
function onCancel(fn) {
	const { runningPrc } = csp
	if (runningPrc === undefined) {
		throw new Error(`ribu: can't call onCancel outside a generator function`)
	}
	runningPrc.onCancel = fn
}


/** @type {(...procS: Proc[]) => Ch} */
export function cancel(...procS) {
	const procCancelChanS = procS.map(p => p.cancel())
	return all(...procCancelChanS)
}


/** @type {(...chanS: Array<Ch | undefined>) => Ch} */
export function all(...chanS) {
	const allDone = ch()
	const chansL = chanS.length
	const notifyDone = ch(chansL)

	for (const chan of chanS) {
		if (chan === undefined) continue
		go(function* () {
			yield chan.rec
			yield notifyDone.put()
		})
	}

	go(function* collectDones() {
		let nDone = 0
		while (nDone < chansL) {
			yield notifyDone.rec
			nDone++
		}
		yield allDone.put()
	})

	return allDone
}


/** @type {(...chanS: Ch[]) => Ch} */
export function or(...chanS) {
	const anyDone = ch()
	let done = false

	for (const chan of chanS) {
		go(function* () {
			yield chan.rec
			if (done === true) {
				return
			}
			done = true
			yield anyDone.put()
		})
	}

	return anyDone
}


/** @type {(fn: Function, done?: Ch) => Ch} */
export function doAsync(fn, done = ch()) {
	go(function* _doAsync() {
		fn()
		yield done.put()
	})
	return done
}


/**
 * @implements {Ch}
 */
export class BroadcastCh {

	/** @type {Ch | Array<Ch> | undefined} */
	#listeners = undefined

	/** @return {YIELD_VAL} */
	get rec() {

		const listenerCh = ch()
		const listeners = this.#listeners

		if (listeners === undefined) {
			this.#listeners = listenerCh
		}
		else if (Array.isArray(listeners)) {
			listeners.push(listenerCh)
		}
		else {
			this.#listeners = []
			this.#listeners.push(listenerCh)
		}

		return listenerCh.rec
	}

	/** @type {() => YIELD_VAL} */
	put() {

		const notifyDone = ch()
		const listeners = this.#listeners

		go(function* _emit() {
			if (listeners === undefined) {
				yield notifyDone.rec
				return
			}
			if (Array.isArray(listeners)) {
				for (const ch of listeners) {
					yield ch.put()
				}
				yield notifyDone.rec
				return
			}
			yield listeners.put()
			yield notifyDone.rec
		})

		return notifyDone.put()
	}
}

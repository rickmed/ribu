import { go, ch, sleep, done } from "./ribu.mjs"

import { csp } from "./initCsp.mjs"


/** @type {Symbol} */
export const YIELD_VAL = Symbol("ribu yield val")

const RUNNING = 1, CANCELLING = 2, DONE = 3
const PARK = 1, RESUME = 2

/**
 * The generator manager
 */
export class Prc {

	#gen
	#csp
	done = /** @type {Ribu.Ch} */ (ch())

	/**
	 * For bubbling errors up
	 * undefined for top-root prcS
	 * @type {Prc | undefined} */
	#parentPrc = undefined

	/** @type {Set<Prc> | undefined} */
	childPrcS = undefined

	/** @type {_Ribu.GenFn | Function | undefined} */
	cancelFn = undefined

	/** @type {RUNNING | CANCELLING | DONE} */  // genFn is ran immediately
	#state = RUNNING
	/** @type {PARK | RESUME} */
	#execNext = RESUME

	/** @type {any} */
	#inOrOutMsg = undefined   // bc first gen.next(inOrOutMsg) is ignored

	/** @type {Ribu.Proc | undefined} */
	#$deadline = undefined

	/**
	 * @param {_Ribu.Gen_or_GenFn} gen_or_genFn
	 * @param {_Ribu.Csp} csp
	 */
	constructor(gen_or_genFn, csp) {

		const gen = isGenFn(gen_or_genFn) ?
			/** @type {_Ribu.GenFn} */(gen_or_genFn)() :
			gen_or_genFn

		this.#gen = gen
		this.#csp = csp

		const parentPrc = csp.runningPrc

		if (parentPrc === undefined) {
			return
		}

		this.#parentPrc = parentPrc

		if (parentPrc.childPrcS === undefined) {
			parentPrc.childPrcS = []
		}
		parentPrc.childPrcS.add(this)
	}

	run() {

		this.#csp.runningPrc = this

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
					const prom = value
					const thisPrc = this

					prom.then(onVal, onErr)
					this.setPark()
					break

					/** @param {any} val */
					function onVal(val) {
						if (thisPrc.#state === DONE) {
							return
						}
						thisPrc.setResume(val)
						thisPrc.run()
					}

					/** @param {any} err */
					function onErr(err) {
						if (thisPrc.#state === DONE) {
							return
						}
						// @todo implement processes supervisors
						thisPrc.#gen.throw(err)
					}
				}

				// @todo: yields a launch of a process

				// @todo: remove this?
				throw new Error(`can't yield something that is not a channel operation, sleep, go() or a promise`)
			}
		}

		if (gen_is_done) {
			this.#state = DONE
			this.delParentChildRefs()
			const this_ = this
			go(function* _notifyDone() { yield this_.done.put() })
			return
		}

		this.#csp.runScheduledPrcS()
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

	/** @type {(msDeadline?: number) => Ribu.Ch} */
	cancel(deadline = this.#csp.defaultDeadline) {

		this.#state = DONE
		this.#gen.return()

		const doneCh = /** @type {Ribu.Ch} */ (ch())

		const { cancelFn } = this
		const $childPrcS = this.childPrcS

		if ($childPrcS === undefined) {
			if (cancelFn === undefined) {
				return doneCh
			}
			if (cancelFn.constructor === Function) {
				cancelFn()
				return doneCh
			}
		}

		/* @todo: consider case where $childPrcS exists but cancelFn doesn't */
		const $cancelFn = _go(/** @type {_Ribu.GenFn} */(cancelFn))

		this.#$deadline = this.new$deadline(deadline, doneCh, $cancelFn, /** @type {Set<Prc>} */ ($childPrcS))

		const this_ = this

		_go(function* _updateDeadline() {

			yield 1  // @todo where do deadline updates come from??
			this_.#$deadline = this_.new$deadline(deadline, doneCh, $cancelFn, /** @type {Set<Prc>} */ ($childPrcS))
		})

		_go(function* _waitCancelFnAndChildren() {
			yield done($cancelFn, ...[.../** @type {Set<Prc>} */ ($childPrcS)])
			yield /** @type {Prc} */(this_.#$deadline).cancel()
			yield doneCh.put()
		})

		this.delParentChildRefs()
		return doneCh
	}

	/** @type {(deadline: number, doneCh: Ribu.Ch, $cancelFn: Ribu.Proc, $childPrcS: Set<Prc>) => Ribu.Proc} */
	new$deadline(deadline, doneCh, $cancelFn, $childPrcS) {
		return _go(function* _deadline() {
			yield sleep(deadline)
			yield this.hardCancel($cancelFn, $childPrcS)
			yield doneCh.put()
		})
	}

	/** @type {(...procS: Ribu.Proc[]) => Ribu.Ch} */
	hardCancel(...procS) {
		const doneCh = /** @type {Ribu.Ch} */ (ch())
		this.#state = DONE  //  will most likely be done already by .cancel(), but just for good measure
		_go(function* _hardCancel() {
			yield done(...procS)
		})
		this.delParentChildRefs()
		return doneCh
	}

	delParentChildRefs() {
		this.#parentPrc?.childPrcS?.delete(this)
		this.#parentPrc = undefined
	}

}


/**
 * @param {_Ribu.Gen_or_GenFn} gen_or_genFn
 * @returns {_Ribu.Prc}
 */
export function _go(gen_or_genFn) {
	const prc = new Prc(gen_or_genFn, csp)
	prc.run()
	return prc
}


const GenFnConstructor = function* () { }.constructor

/** @type {(x: any) => boolean} */
function isGenFn(x) {
	if (x instanceof GenFnConstructor) {
		return true
	}
	return false
}

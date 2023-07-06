import { go, sleep, BroadcastCh as BroadCastCh, all, doAsync } from "./ribu.mjs"


/**
 * @template [TChVal=undefined]
 * @typedef {Ribu.Ch<TChVal>} Ch<TChVal>
 */
/** @typedef {Ribu.Proc} Proc */
/** @typedef {Ribu.Gen} Gen */
/** @typedef {_Ribu.GenFn} GenFn */
/** @typedef {_Ribu.CancelScope} CancelScope */


export const YIELD_VAL = "RIBU_YIELD_VAL"

const RUNNING = 1, CANCELLING = 2, DONE = 3
const PARK = 1, RESUME = 2

/**
 * The generator manager
 */
export class Prc {

	#gen
	#csp
	done = new BroadCastCh()

	/* genFn is ran immediately */
	/** @type {RUNNING | CANCELLING | DONE} */
	#state = RUNNING
	/** @type {PARK | RESUME} */
	#execNext = RESUME
	/** @type {unknown} */
	#inOrOutMsg = undefined   // bc first gen.next(inOrOutMsg) is ignored

	/** @type {Prc | undefined} - For bubbling errors up (undefined for root prcS) */
	#parentPrc = undefined
	/** @type {Set<Prc> | undefined} - For auto cancel child Procs */
	$childS = undefined

	/** @type {GenFn | Function | undefined} - Set up by ribu.onCancel() */
	onCancel = undefined
	/** @type {CancelScope=} - Concurrent state kept for Prc.cancel() calls */
	#cancelScope = undefined
	/** @type {number} */
	deadline

	/**
	 * @param {Gen} gen
	 * @param {_Ribu.Csp} csp
	 * @param {number=} deadline
	 */
	constructor(gen, csp, deadline = csp.defaultDeadline) {

		this.#gen = gen
		this.#csp = csp

		const parentPrc = csp.runningPrc

		if (parentPrc) {
			const parentDL = parentPrc.deadline
			deadline = deadline > parentDL ? parentDL : deadline

			this.#parentPrc = parentPrc

			if (parentPrc.$childS === undefined) {
				parentPrc.$childS = new Set()
			}
			parentPrc.$childS.add(this)
		}

		this.deadline = deadline
	}

	run() {

		this.#csp.runningPrc = this

		let genDone = false
		while (true) {  // eslint-disable-line no-constant-condition

			const exec = this.#execNext

			if (exec === PARK) {
				break
			}

			if (exec === RESUME) {

				const { done, value } = this.#gen.next(this.#inOrOutMsg)

				if (done === true) {
					genDone = true
					break
				}

				if (value === YIELD_VAL) {
					continue  // all ribu yieldables set the appropiate conditions to be checked in next loop
				}

				// yielded a promise
				if (value instanceof Promise) {
					const prom = value

					const thisPrc = this

					prom.then(onVal, onErr)
					this.setPark()
					break

					/** @param {unknown} val */
					function onVal(val) {
						if (thisPrc.#state === DONE) {
							return
						}
						thisPrc.setResume(val)
						thisPrc.run()
					}

					/** @param {unknown} err */
					function onErr(err) {
						if (thisPrc.#state === DONE) {
							return
						}
						// @todo implement processes supervisors
						thisPrc.#gen.throw(err)
					}
				}

				// @todo: remove this?
				throw new Error(`can't yield something that is not a channel operation, sleep, go() or a promise`)
			}
		}

		if (genDone) {
			go(this.#genDoneCleanup)
			return
		}

		this.#csp.runScheduledPrcS()
	}

	pullOutMsg() {
		const outMsg = this.#inOrOutMsg
		this.#inOrOutMsg = undefined
		return outMsg
	}

	/** @type {(inOrOutMsg?: unknown) => void} */
	setResume(inOrOutMsg) {
		this.#execNext = RESUME
		this.#inOrOutMsg = inOrOutMsg
	}

	/** @type {(inOrOutMsg?: unknown) => void} */
	setPark(inOrOutMsg) {
		this.#execNext = PARK
		this.#inOrOutMsg = inOrOutMsg
	}

	/** @type {(inOrOutMsg?: unknown) => void} */
	queueToRun(inOrOutMsg) {
		this.setResume(inOrOutMsg)
		this.#csp.schedule(this)
	}

	*#genDoneCleanup() {

		this.#state = DONE

		const { done, $childS } = this

		if ($childS && $childS.size > 0) {
			yield this.#cancelChildS().rec
		}

		this.#nilParentRefs()
		yield done.put()
	}

	/** @type {() => Ch} */
	cancel() {

		const state = this.#state
		const { done } = this

		if (state === DONE || state === CANCELLING) {
			/* @todo
				when I implement done -> results/errs, the results/errs must be kept inside cache
				and be returned here for late proc.done callers
			*/
			return done
		}

		this.#state = CANCELLING
		this.#gen.return()

		const { $childS, onCancel } = this

		if ($childS === undefined) {

			if (onCancel === undefined) {
				return doAsync(this.#cancelFinalCleanup, done)
			}

			else if (onCancel.constructor === Function) {
				onCancel()
				return doAsync(this.#cancelFinalCleanup, done)
			}
			else { /* onCancel is GenFn */

				this.#cancelScope = {
					$deadline: this.#new$deadline(),
					$onCancel: this.#new$onCancel(),
				}

				go(this.#handle$CancelS)
				return done
			}

		}
		else { /* Prc has childS */

			// Since Prc has childS, need to launch a deadline process to hard
			// cancel if childS.cancel() take too long

			/** @type {CancelScope} */
			const cancelScope = {
				$deadline: this.#new$deadline(),
				childSCancelDone: this.#cancelChildS(),
			}

			// if (onCancel === undefined) { no need to do anything else }

			if (onCancel?.constructor === Function) {
				onCancel()
			}
			else { /* onCancel is GenFn */
				cancelScope.$onCancel = this.#new$onCancel()
			}

			this.#cancelScope = cancelScope
			go(this.#handle$CancelS)
			return done
		}
	}

	/** @type {() => Proc} */
	#new$deadline() {
		const this_ = this
		return go(function* _$deadline() {
			yield sleep(this_.deadline)
			yield this_.hardCancel().rec
			yield this_.done.put()
		})
	}

	*#handle$CancelS() {
		const cancelScope = /** @type {CancelScope} */ (this.#cancelScope)
		const { $onCancel, childSCancelDone, $deadline } = cancelScope

		yield all($onCancel?.done, childSCancelDone).rec

		// If I reach here, it means I wasn't cancelled by cancelScope.$deadline,
		// so need to cancel $deadline

		yield $deadline.cancel().rec
		yield this.done.put()
	}

	/** @type {() => Ch} */
	hardCancel() {
		const { $childS } = this
		const cancelScope = this.#cancelScope

		/** @type {Array<Ch>} */
		let doneChs = []

		doneChs.push(doAsync(this.#cancelFinalCleanup, this.done))

		if (cancelScope?.$onCancel) {
			doneChs.push(cancelScope.$onCancel.hardCancel())
		}

		if ($childS) {
			for (const prc of $childS) {
				doneChs.push(prc.hardCancel())
			}
		}

		return all(...doneChs)
	}

	#nilParentRefs() {
		this.#parentPrc?.$childS?.delete(this)
		this.#parentPrc = undefined
	}

	#cancelFinalCleanup() {
		this.#state = DONE
		this.#nilParentRefs()
	}

	/** @type {() => Ch} */
	#cancelChildS() {
		const $childS = /** @type {Set<Prc>} */ (this.$childS)

		let cancelChs = []
		for (const prc of $childS) {
			cancelChs.push(prc.cancel())
		}
		return all(...cancelChs)
	}

	/** @type {() => Prc} */
	#new$onCancel() {
		const onCancel = /** @type {GenFn} */(this.onCancel)
		return new Prc(onCancel(), this.#csp)
	}
}

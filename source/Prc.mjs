import { go, ch, sleep, done, BroadcastCh } from "./ribu.mjs"


/**
 * @template [TChVal=undefined]
 * @typedef {_Ribu.Ch<TChVal>} Ch<TChVal>
 */
/** @typedef {Ribu.Proc} Proc */
/** @typedef {Ribu.Gen} Gen */
/** @typedef {_Ribu.GenFn} GenFn */


export const YIELD_VAL = "RIBU_YIELD_VAL"

const RUNNING = 1, CANCELLING = 2, DONE = 3
const PARK = 1, RESUME = 2

/**
 * The generator manager
 */
export class Prc {

	#gen
	#csp

	/**
	 * For bubbling errors up
	 * is undefined for root prcS
	 * @type {Prc | undefined} */
	#parentPrc = undefined

	/** @type {Set<Prc> | undefined} */
	$childPrcS = undefined

	/** @type {GenFn | Function | undefined} */
	cancelFn = undefined

	/** @type {RUNNING | CANCELLING | DONE} */  // genFn is ran immediately
	#state = RUNNING
	/** @type {PARK | RESUME} */
	#execNext = RESUME

	/** @type {unknown} */
	#inOrOutMsg = undefined   // bc first gen.next(inOrOutMsg) is ignored

	done = new BroadcastCh()

	/** @type {Proc | undefined} */
	#$deadline = undefined

	/**
	 * @param {Gen} gen
	 * @param {_Ribu.Csp} csp
	 */
	constructor(gen, csp) {

		this.#gen = gen
		this.#csp = csp

		const parentPrc = csp.runningPrc

		if (parentPrc === undefined) {
			return
		}

		this.#parentPrc = parentPrc

		if (parentPrc.$childPrcS === undefined) {
			parentPrc.$childPrcS = new Set()
		}
		parentPrc.$childPrcS.add(this)
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

				// @todo: yields a launch of a process

				// @todo: remove this?
				throw new Error(`can't yield something that is not a channel operation, sleep, go() or a promise`)
			}
		}

		if (gen_is_done) {
			this.#state = DONE
			this.nilParentChildRefs()
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

	/** @type {(msDeadline?: number) => Ch} */
	cancel(deadline = this.#csp.defaultDeadline) {

		const state = this.#state
		const notifyDone = this.done
		const concuCancel = /** @type Ch<number> */ (/** @type unknown */ (ch()))

		if (state === DONE) {
			// @todo: when I implement done -> results/errs, the results/errs must be kept inside cache
			// and be returned here (for late proc.done callers)
			return notifyDone
		}

		if (state === CANCELLING) {
			go(function* _notifyConcuCancel() { yield concuCancel.put()})
		}

		this.#state = CANCELLING
		this.#gen.return()

		const {cancelFn, $childPrcS} = this

		if ($childPrcS === undefined) {
			if (cancelFn?.constructor === Function) {   // covers cancelFn is undefined | Fn
				cancelFn()
			}
			this.#state = DONE
			this.nilParentChildRefs()
			return notifyDone
		}

		const $cancelFn = go(/** @type {GenFn} */(cancelFn))

		this.#$deadline = this.new$deadline(deadline, notifyDone, $cancelFn, /** @type {Set<Prc>} */ ($childPrcS))

		const this_ = this

		go(function* _updateDeadline() {
			// update this.$deadline and call child.cancel again so that they can update deadline

			yield concuCancel.rec
			this_.#$deadline = this_.new$deadline(deadline, notifyDone, $cancelFn, /** @type {Set<Prc>} */ ($childPrcS)).rec
		})

		go(function* _waitCancelFnAndChildren() {
			yield done($cancelFn, ...[.../** @type {Set<Prc>} */ ($childPrcS)]).rec
			yield /** @type {Prc} */(this_.#$deadline).cancel().rec
			yield notifyDone.put()
		})

		this.nilParentChildRefs()
		this.#state = DONE
		return notifyDone
	}

	/** @type {(deadline: number, doneCh: Ch, $cancelFn: Proc, $childPrcS: Set<Prc>) => Proc} */
	new$deadline(deadline, doneCh, $cancelFn, $childPrcS) {
		const this_ = this
		return go(function* _deadline() {
			yield sleep(deadline)
			yield this_.hardCancel($cancelFn, $childPrcS).rec
			yield doneCh.put()
		})
	}

	/** @type {(...procS: Proc[]) => Ch} */
	hardCancel(...procS) {
		const doneCh = /** @type {Ch} */ (ch())
		this.#state = DONE  //  will most likely be done already by .cancel(), but just for good measure
		// @ todo call children and cancelFn .hardCancel()
		go(function* _hardCancel() {
			yield done(...procS).rec
		})
		this.nilParentChildRefs()
		return doneCh
	}

	nilParentChildRefs() {
		this.#parentPrc?.$childPrcS?.delete(this)
		this.#parentPrc = undefined
	}

}



/*
Yes I need some internal class state about cancellation
bc Prc is just wrapped lightly from go() so prc.cancel() is called twice

parentProc is cancelled (along with its child). Then, concurrently,
granparentProc is cancelled, which calls proc.cancel() and
child.cancel() again

So need to update the deadline in proc and childProc
(accounting for time passed


*/
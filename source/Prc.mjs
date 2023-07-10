import { all } from "./index.mjs"
import csp from "./initCsp.mjs"
import { ch } from "./channels.mjs"


/**
 * @template [TChVal=undefined]
 * @typedef {Ribu.Ch<TChVal>} Ch<TChVal>
 */
/** @typedef {Ribu.Proc} Proc */
/** @typedef {_Ribu.Gen_or_GenFn} Gen_or_GenFn */
/** @typedef {Ribu.Gen} Gen */
/** @typedef {_Ribu.GenFn} GenFn */
/** @typedef {_Ribu.CancelScope} CancelScope */



/* === Prc class ====================================================== */

export const YIELD_VAL = "RIBU_YIELD_VAL"

const RUNNING = "RUNNING", CANCELLING = "CANCELLING", DONE = "DONE"
const RESUME = "RESUME", PARK = "PARK"

/**
 * The generator manager
 */
export class Prc {

	/** undefined when instantiated in Cancellable  */
	_gen

	/* defaults are RUNNING and RESUME because gen is ran immediately */
	/** @type {RUNNING | CANCELLING | DONE} */
	_state = RUNNING
	/** @type {PARK | RESUME} */
	_execNext = RESUME

	/**
	 * Whatever is yield/.next() to/from the generator.
	 * Default is undefined because first .next(genMsg) is ignored anyways
	 * @type {unknown} */
	_genMsg = undefined

	/** @type {Prc | undefined} - For bubbling errors up (undefined for root prcS) */
	_parentPrc = undefined
	/** @type {Set<Prc> | undefined} - For auto cancel child Procs */
	_$childS = undefined

	/** @type {GenFn | Function | undefined} */
	onCancel = undefined
	/** @type {number} */
	_deadline

	/**
	 * Setup by sleep(). Used by .cancel() to clearTimeout(_timeoutID)
	 * @type {NodeJS.Timeout | undefined} */
	_timeoutID = undefined

	done = ch()

	/**
	 * @param {boolean=} isUserPrc
		* Used to launch "special"/internal PrcS in Prc.cancel() which don't
		* have children to auto cancel (that would create infinite loops)
	 * @param {Gen_or_GenFn=} gen_or_genFn
		  * undefined when instantiated in Cancellable
	 * @param {number=} deadline
	 */
	constructor(isUserPrc, gen_or_genFn, deadline = csp.defaultDeadline) {

		const gen =
			gen_or_genFn === undefined ? undefined :
				gen_or_genFn instanceof Function ? gen_or_genFn() :
					gen_or_genFn

		this._gen = gen

		const parentPrc = csp.runningPrc

		if (parentPrc) {

			const parentDL = parentPrc._deadline
			deadline = deadline > parentDL ? parentDL : deadline

			this._parentPrc = parentPrc

			if (isUserPrc) {
				if (parentPrc._$childS === undefined) {
					parentPrc._$childS = new Set()
				}
				parentPrc._$childS.add(this)
			}
		}

		this._deadline = deadline
	}

	/** @type {() => Ch} */
	cancel() {

		const state = this._state
		const { done } = this

		if (state === DONE) {
			/* @todo: when state === DONE (late .cancel() callers)
				when I implement done -> results/errs, the results/errs must be kept inside cache
				and be returned here for late proc.done callers
			*/
			return done
		}

		if (state === CANCELLING) {
			/* @todo: concurrent .cancel() calls:
				need to return some ch to caller that when cancel protocol is done it will notify
			*/
			return done
		}

		this._state = CANCELLING
		this._gen?.return()
		csp.scheduledPrcS.delete(this)
		ifSleepTimeoutClear(this)

		const { _$childS, onCancel } = this

		if (_$childS === undefined) {

			if (onCancel === undefined) {
				nilParentRefAndMarkDONE(this)
				return done
			}

			if (onCancel.constructor === Function) {
				onCancel()
				nilParentRefAndMarkDONE(this)
				return done
			}

			return $onCancel(this)
		}
		else { /* Prc has childS */

			if (onCancel === undefined) {
				return cancelChildSAndFinish(this)
			}

			if (onCancel.constructor === Function) {
				onCancel()
				return cancelChildSAndFinish(this)
			}

			return runChildSCancelAndOnCancel(this)
		}
	}
}


/** @type {(prc: Prc) => void} */
export function run(prc) {

	csp.prcStack.push(prc)

	let genDone = false
	while (genDone === false) {

		const exec = prc._execNext

		if (exec === PARK) {
			break
		}

		if (exec === RESUME) {

			// cast ok since _gen can only be undefined with Cancellable()
			// which never calls .run()
			const gen = /** @type {Ribu.Gen} */ (prc._gen)
			const { done, value } = gen.next(prc._genMsg)

			if (done === true) {
				genDone = true
				break
			}

			if (value === YIELD_VAL) {
				// all ribu yieldables set the appropiate conditions to be
				// checked in the next while loop
				continue
			}

			if (value instanceof Promise) {
				const prom = value

				prom.then(onVal, onErr)
				setPark(prc)
				break

				// helpers
				/** @param {unknown} val */
				function onVal(val) {
					if (prc._state !== RUNNING) {
						return
					}
					setResume(prc, val)
					run(prc)
				}

				/** @param {unknown} err */
				function onErr(err) {
					if (prc._state !== RUNNING) {
						return
					}
					// @todo implement errors
					throw err
				}
			}
		}
	}

	csp.prcStack.pop()

	if (genDone) {
		_go(_$finishGenNormalDone(prc))
		return
	}

	csp.runScheduledPrcS()
}


/** @type {(prc: Prc) => unknown} */
export function pullOutMsg(prc) {
	const outMsg = prc._genMsg
	prc._genMsg = undefined
	return outMsg
}


/** @type {(prc: Prc, genMsg?: unknown) => YIELD_VAL} */
export function setResume(prc, genMsg) {
	prc._execNext = RESUME
	prc._genMsg = genMsg
	return YIELD_VAL
}

/** @type {(prc: Prc, genMsg?: unknown) => YIELD_VAL} */
export function setPark(prc, genMsg) {
	prc._execNext = PARK
	prc._genMsg = genMsg
	return YIELD_VAL
}


/** @param {Prc} prc */
function* _$finishGenNormalDone(prc) {
	prc._state = DONE

	const { done, _$childS } = prc

	// No need to put a deadline on auto canceling any active children because,
	// at instantiation, they have a shorter/equal deadline than this prc
	if (_$childS && _$childS.size > 0) {
		yield cancelChildS(prc).rec
	}

	prc._parentPrc = undefined
	yield done.put()
}


/** @type {(prc: Prc, done?: Ch) => Ch} */
function cancelChildS(prc, done = ch()) {

	const $childS = /** @type {Set<Prc>} */ (prc._$childS)

	_go(function* _cancelChildS() {
		let cancelChs = []
		for (const prc of $childS) {
			cancelChs.push(prc.cancel())
		}
		yield all(...cancelChs).rec
		prc._$childS = undefined
		yield done.put()
	})

	return done
}


/** @type {(prc: Prc) => void} */
function nilParentRefAndMarkDONE(prc) {
	prc._state = DONE
	prc._parentPrc = undefined
}


/** @type {(prc: Prc) => Ch} - Doesn't reuse prc.done */
function $onCancel(prc) {

	const done = ch()

	const $onCancel = _go(function* $onCancel() {
		yield _go( /** @type {GenFn} */(prc.onCancel)).done.rec
		// need to cancel $deadline because I won the race
		yield $deadline.cancel().rec
		nilParentRefAndMarkDONE(prc)
		yield done.put()
	})

	const $deadline = _go(function* _deadline() {
		yield sleep(prc._deadline)
		hardCancel($onCancel)
		yield done.put()
	})

	return done
}


/** @type {(prc: Prc) => void} */
function hardCancel(prc) {
	prc._state = DONE
	ifSleepTimeoutClear(prc)
	prc._gen?.return()
	prc._parentPrc = undefined
	prc._$childS = undefined
}


/** @type {(prc: Prc) => Ch} */
function cancelChildSAndFinish(prc) {
	const { done } = prc

	_go(function* cancelChildSAndFinish() {
		yield cancelChildS(prc, prc.done).rec
		yield done.put()
	})

	return done
}


/** @type {(prc: Prc) => void} */
function ifSleepTimeoutClear(prc) {
	const timeoutID = prc._timeoutID
	if (timeoutID !== undefined) {
		clearTimeout(timeoutID)
	}
}


/** @type {(prc: Prc) => Ch} */
function runChildSCancelAndOnCancel(prc) {

	_go(function* _handleChildSAndOnCancel() {
		const childSCancelDone = cancelChildS(prc)
		const onCancelDone = $onCancel(prc)
		yield all(childSCancelDone, onCancelDone).rec
		yield prc.done.put()
	})

	return prc.done
}


/* === Prc constructors ====================================================== */

/**
 * @template {string} TKs
 * @param {Gen_or_GenFn} gen_or_genFn
 * @param {_Ribu.Conf<TKs>=} conf
 * @returns {Prc & _Ribu.Ports<TKs>}
 */
export function go(gen_or_genFn, conf) {

	const deadline = /** @type {number=} */
		(conf && ("deadline" in conf) ? conf.deadline : undefined)

	const prc = new Prc(true, gen_or_genFn, deadline)

	if (conf !== undefined) {
		for (const k in conf) {
			const optsVal = conf[k]
			// @ts-ignore
			prc[k] = optsVal
		}
	}

	run(prc)
	/* @ts-ignore */
	return prc
}


/**
 * A way to create a new Prc which sets it up as a child of last called go()
	  * so the parent can child.cancel() and thus onCancel is ran.
 * @type {(onCancel: Function | _Ribu.GenFn) => Prc}
 */
export function Cancellable(onCancel) {
	const prc = new Prc()
	prc.onCancel = onCancel
	return prc
}


/** @type {(gen_or_genFn: Gen_or_GenFn) => Prc}  */
function _go(gen_or_genFn) {
	const prc = new Prc(false, gen_or_genFn)
	run(prc)
	return prc
}



/* === Sleep ====================================================== */

/** @type {(ms: number) => YIELD_VAL} */
export function sleep(ms) {
	const runningPrc = /** @type {_Ribu.Prc} */ (csp.runningPrc)
	const timeoutID = setTimeout(() => {
		setResume(runningPrc)
		run(runningPrc)
	}, ms)
	runningPrc._timeoutID = timeoutID
	return setPark(runningPrc)
}
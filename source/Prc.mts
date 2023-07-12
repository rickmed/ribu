import { all } from "./index.mts"
import csp from "./initCsp.mts"
import { Ch, ch } from "./channels.mts"


/* === Proc class ====================================================== */

export const YIELD_VAL = "RIBU_YIELD_VAL"

export type YIELD_V = typeof YIELD_VAL

export type Gen<Rec = unknown> =
	Generator<YIELD_V | Promise<unknown>, void, Rec>

type GenFn<Rec = unknown> =
	(this: Prc, ...args: any[]) => Gen<Rec>

type PrcState = "RUNNING" | "CANCELLING" | "DONE"
type ExecNext = "RESUME" | "PARK"

type OnCancel = Function | GenFn

/**
 * The generator manager
 */
export class Prc {

	/** undefined when instantiated in Cancellable  */
	_gen?: Gen = undefined

	/* defaults are RUNNING/RESUME because gen is ran immediately */
	_state: PrcState = "RUNNING"
	_execNext: ExecNext = "RESUME"

	/**
	 * Whatever is yield/.next() to/from the generator.
	 * Default is undefined because first .next(genMsg) is ignored anyways
	 */
	_genMsg: unknown = undefined

	/** For bubbling errors up (undefined for root prcS) */
	_parentPrc?: Prc = undefined
	/** For auto cancel child Procs */
	_$childS?: Set<Prc> = undefined

	onCancel?: OnCancel  = undefined
	_deadline: number

	/** Setup by sleep(). Used by .cancel() to clearTimeout(_timeoutID) */
	_timeoutID?: NodeJS.Timeout = undefined

	done = ch()

	/**
	 * @param {boolean} isUserPrc
		* Used to launch "special"/internal PrcS, used in Prc.cancel(), which don't
		* have children to auto cancel that would create infinite loops.
		* Used alongside with no genFn
	 */
	constructor(isUserPrc: boolean, deadline = csp.defaultDeadline) {

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

		if (state === "DONE") {
			/* @todo: when state === DONE (late .cancel() callers)
				when I implement done -> results/errs, the results/errs must be kept inside cache
				and be returned here for late proc.done callers
			*/
			return done
		}

		if (state === "CANCELLING") {
			/* @todo: concurrent .cancel() calls:
				need to return some ch to caller that when cancel protocol is done it will notify
			*/
			return done
		}

		this._state = "CANCELLING"
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

export function run(prc: Prc): void {

	csp.prcStack.push(prc)

	let genDone = false
	while (genDone === false) {

		const exec = prc._execNext

		if (exec === "PARK") {
			break
		}

		if (exec === "RESUME") {

			// ok to cast since _gen can only be undefined with Cancellable()
			// which never calls .run()
			const gen = prc._gen as Gen
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

				prom.then(
					function onVal(val: unknown) {
						if (prc._state !== "RUNNING") {
							return
						}
						setResume(prc, val)
						run(prc)
					},
					function onErr(err: unknown) {
						if (prc._state !== "RUNNING") {
							return
						}
						// @todo implement errors
						throw err
					}
				)

				setPark(prc)
				break
			}
		}
	}

	csp.prcStack.pop()

	if (genDone) {
		_go(finishGenNormalDone, prc)
		return
	}

	csp.runScheduledPrcS()
}

export function pullOutMsg(prc: Prc): unknown {
	const outMsg = prc._genMsg
	prc._genMsg = undefined
	return outMsg
}

export function setResume(prc: Prc, genMsg?: unknown): YIELD_V  {
	prc._execNext = "RESUME"
	prc._genMsg = genMsg
	return YIELD_VAL
}

export function setPark(prc: Prc, genMsg?: unknown): YIELD_V {
	prc._execNext = "PARK"
	prc._genMsg = genMsg
	return YIELD_VAL
}

function* finishGenNormalDone(prc: Prc) {
	prc._state = "DONE"

	const { done, _$childS } = prc

	// No need to put a deadline on auto canceling any active children because,
	// at instantiation, they have a shorter/equal deadline than this prc
	if (_$childS && _$childS.size > 0) {
		yield cancelChildS(prc).rec
	}

	prc._parentPrc = undefined
	yield done.put()
}

function cancelChildS(prc: Prc, done = ch()) {

	const $childS = prc._$childS as Set<Prc>

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

function nilParentRefAndMarkDONE(prc: Prc) {
	prc._state = "DONE"
	prc._parentPrc = undefined
}

/** Doesn't reuse prc.done */
function $onCancel(prc: Prc) {

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

function hardCancel(prc: Prc) {
	prc._state = "DONE"
	ifSleepTimeoutClear(prc)
	prc._gen?.return()
	prc._parentPrc = undefined
	prc._$childS = undefined
}

function cancelChildSAndFinish(prc: Prc) {
	const { done } = prc

	_go(function* cancelChildSAndFinish() {
		yield cancelChildS(prc, prc.done).rec
		yield done.put()
	})

	return done
}

function ifSleepTimeoutClear(prc: Prc) {
	const timeoutID = prc._timeoutID
	if (timeoutID !== undefined) {
		clearTimeout(timeoutID)
	}
}

function runChildSCancelAndOnCancel(prc: Prc) {

	_go(function* _handleChildSAndOnCancel() {
		const childSCancelDone = cancelChildS(prc)
		const onCancelDone = $onCancel(prc)
		yield all(childSCancelDone, onCancelDone).rec
		yield prc.done.put()
	})

	return prc.done
}


/* === Prc constructors ====================================================== */

type Conf<TKs extends string> = {
   [K in TKs]:
      K extends keyof Prc ? never :
      K extends "deadline" ? number :
      Ch
}

type Ports<TConfKs extends string> =
   Omit<Conf<TConfKs>, "deadline">

type PublicProc = {
	readonly done: Ch
	readonly cancel: () => Ch
	onCancel: GenFn | Function
}

type Proc<Ports> = PublicProc & Ports

/**
 * @template {string} TKs
 * @param {GenFn} genFn
 * @param {_Ribu.Conf<TKs>=} conf
 * @returns {Ribu.Proc<_Ribu.Ports<TKs>>}
 */

// const $p1 = go({deadline: 4000, filePathS: ch(30)}, genFn, "arg2"...)
// const $p2 = go(genFn, "arg1", "arg2"...)
// const $p3 = go(genFn)

export function go<_GenFnArgs, _ConfKs>(genFn: GenFn, ...genFnArgs: _GenFnArgs[]): Proc<_ConfKs> {

	const proc = new Prc()


	// const deadline = /** @type {number=} */
	// 	(conf && ("deadline" in conf) ? conf.deadline : undefined)

	// const prc = new Prc(true, deadline, genFn)

	// if (conf) {
	// 	for (const k in conf) {
	// 		const optsVal = conf[k]
	// 		// @ts-ignore
	// 		prc[k] = optsVal
	// 	}
	// }

	// run(prc)
	// /* @ts-ignore */
	// return prc
}


/**
 * A way to create a new Prc which sets it up as a child of last called go()
 * so the parent can child.cancel() and thus onCancel is ran.
 */
export function Cancellable(onCancel: OnCancel) {
	const prc = new Prc(true)
	prc.onCancel = onCancel
	return prc
}


/**
 * @type {(genFn: GenFn, ...genFnArgs: unknown[]) => Prc<typeof genFnArgs>}  */
function _go(genFn, ...genFnArgs) {
	const prc = new Prc(false, undefined, genFn, ...genFnArgs)
	run(prc)
	return prc
}



/* === Sleep ====================================================== */

/** @type {(ms: number) => YIELD_V} */
export function sleep(ms) {
	const runningPrc = /** @type {_Ribu.Prc} */ (csp.runningPrc)
	const timeoutID = setTimeout(() => {
		setResume(runningPrc)
		run(runningPrc)
	}, ms)
	runningPrc._timeoutID = timeoutID
	return setPark(runningPrc)
}
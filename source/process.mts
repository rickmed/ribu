import { all } from "./index.mjs"
import csp from "./initCsp.mjs"
import { ch, BaseChan, type Ch } from "./channel.mjs"


/* === Prc class ====================================================== */

/**
 * The generator manager
 */
export class Prc {

	/** undefined when instantiated in Cancellable  */
	_gen?: Gen = undefined
	_genName: string = ""

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

	_onCancel?: OnCancel = undefined
	_deadline: number = csp.defaultDeadline

	/** Setup by sleep(). Used by .cancel() to clearTimeout(_timeoutID) */
	_timeoutID?: NodeJS.Timeout = undefined

	done = ch()

	constructor() {

		const { runningPrc } = csp

		if (runningPrc) {

			this._parentPrc = runningPrc

			if (runningPrc._$childS === undefined) {
				runningPrc._$childS = new Set()
			}

			runningPrc._$childS.add(this)
		}
	}

	deadline(ms: number) {

		const { _parentPrc } = this

		if (_parentPrc) {
			const parentMS = _parentPrc._deadline
			ms = ms > parentMS ? parentMS : ms
		}

		this._deadline = ms
		return this
	}

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

		const { _$childS, _onCancel: onCancel } = this

		if (_$childS === undefined) {

			if (onCancel === undefined) {
				nilParentRefAndMarkDONE(this)
				return done
			}

			if (onCancel.constructor === Function) {
				(onCancel as onCancelFn)()
				nilParentRefAndMarkDONE(this)
				return done
			}

			return $onCancel(this)
		}
		else { /* has _$childS */

			if (onCancel === undefined) {
				return cancelChildSAndFinish(this)
			}

			if (onCancel.constructor === Function) {
				(onCancel as onCancelFn)()
				return cancelChildSAndFinish(this)
			}

			return runChildSCancelAndOnCancel(this)
		}
	}

	ports<_P extends Ports>(ports: _P) {
		const _ports = ports   as WithCancel<_P>
		_ports.cancel = this.cancel.bind(this)
		return _ports
	}
}

export function pullOutMsg(prc: Prc): unknown {
	const outMsg = prc._genMsg
	prc._genMsg = undefined
	return outMsg
}

export function setResume(prc: Prc, genMsg?: unknown): YIELD_T {
	prc._execNext = "RESUME"
	prc._genMsg = genMsg
	return YIELD
}

export function setPark(prc: Prc, genMsg?: unknown): YIELD_T {
	prc._execNext = "PARK"
	prc._genMsg = genMsg
	return YIELD
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

			if (value instanceof BaseChan) {
				value.rec
			}

			if (value === YIELD) {
				// ch.put()/rec and sleep() set the appropiate conditions to be
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
		go(finishNormalDone, prc)
		return
	}

	csp.runScheduledPrcS()
}

function* finishNormalDone(prc: Prc) {

	prc._state = "DONE"

	const { done, _$childS } = prc

	// No need to put a deadline on auto canceling any active children because,
	// at instantiation, they have a shorter/equal deadline than this prc.
	// So just need for them to finish cancelling themselves
	if (_$childS && _$childS.size > 0) {
		yield go(cancelChildS, prc).done
	}

	prc._parentPrc = undefined
	yield done.put()
}

function* cancelChildS(prc: Prc) {
	const $childS = prc._$childS    as Set<Prc>

	let cancelChs = []  // eslint-disable-line prefer-const
	for (const prc of $childS) {
		cancelChs.push(prc.cancel())
	}
	yield all(...cancelChs)
	prc._$childS = undefined
}

function nilParentRefAndMarkDONE(prc: Prc) {
	prc._state = "DONE"
	prc._parentPrc = undefined
}

function $onCancel(prc: Prc) {

	const done = ch()

	const $onCancel = go(function* $onCancel() {
		yield go(prc._onCancel as GenFn).done
		// need to cancel $deadline because I won the race
		yield $deadline.cancel()
		nilParentRefAndMarkDONE(prc)
		yield done.put()
	})

	const $deadline = go(function* _deadline() {
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

	go(function* cancelChildSAndFinish() {
		yield go(cancelChildS, prc).done
		yield done.put()
	})

	return done
}

function ifSleepTimeoutClear(prc: Prc) {
	const timeoutID = prc._timeoutID
	if (timeoutID !== undefined) {
		clearTimeout(timeoutID)
		prc._timeoutID = undefined
	}
}

function runChildSCancelAndOnCancel(prc: Prc) {

	go(function* _handleChildSAndOnCancel() {
		yield all(go(cancelChildS, prc).done, $onCancel(prc))
		yield prc.done.put()
	})

	return prc.done
}



/* === Prc constructor ====================================================== */

export function go<Args extends unknown[], _Ports extends Ports>(
	genFn: GenFn<_Ports, Args>,
	...genFnArgs: Args
): Prc & _Ports {

	const prc = new Prc()    as Prc & _Ports
	prc._genName = genFn.name

	const gen = genFn.call(prc, ...genFnArgs)
	prc._gen = gen

	run(prc)
	return prc
}


/**
 * A way to create a new Prc which sets it up as a child of last called go()
 * so the parent can child.cancel() and thus onCancel is ran.
 */
export function Cancellable(onCancel: OnCancel) {
	const prc = new Prc()
	prc._onCancel = onCancel
	return prc
}


export function onCancel(onCancel: OnCancel): void {
	const runningPrc = csp.runningPrc
	runningPrc._onCancel = onCancel
}



/* === Helpers ====================================================== */

/**
 * Sleep
 */
export function sleep(ms: number): YIELDABLE {
	const runningPrc = csp.runningPrc
	const timeoutID = setTimeout(function _sleepTimeOut() {
		setResume(runningPrc)
		run(runningPrc)
	}, ms)
	runningPrc._timeoutID = timeoutID
	return setPark(runningPrc)
}


/**
 * wait
 */
export function wait(...prcS: Prc[]): Ch {

	const allDone = ch()

	let doneChs: Array<Ch>

	if (prcS.length === 0) {

		const { runningPrc } = csp
		const { _$childS } = runningPrc

		if (_$childS === undefined) {
			return allDone
		}

		const prcDoneChs = []
		for (const prc of _$childS) {
			prcDoneChs.push(prc.done)
		}
		doneChs = prcDoneChs
	}
	else {
		doneChs = prcS.map(proc => proc.done)
	}

	go(function* _donePrc() {
		yield all(...doneChs)
		yield allDone.put()
	})

	return allDone
}


/**
 * Cancel several processes in parallel
 */
export function cancel(...prcS: Prc[]): Ch {
	const procCancelChanS = prcS.map(p => p.cancel())
	return all(...procCancelChanS)
}


/**
 * Convert a sync function to async
 */
export function doAsync(fn: () => void, done = ch()): Ch {
	go(function* _doAsync() {
		fn()
		yield done.put()
	})
	return done
}


/**
 * Race several processes.
 * @todo: implemented when first returns error.
 * Returns the first process that finishes succesfully, ie,
 * if the race winner finishes with errors, it is ignored.
 * The rest (unfinished) are cancelled.
 */
export function race(...prcS: Prc[]): Ch {

	const done = ch<unknown>()

	let prcSDone: Array<Ch> = []   // eslint-disable-line prefer-const
	for (const prc of prcS) {
		prcSDone.push(prc.done)
	}

	for (const chan of prcSDone) {

		go(function* _race() {

			const prcResult: unknown = yield chan

			// remove the winner prc from prcS so that the remainning can be cancelled
			prcS.splice(prcS.findIndex(prc => prc.done == chan), 1)

			go(function* () {
				yield cancel(...prcS)
			})

			yield done.put(prcResult)
		})

	}

	return done
}



/* === Types ====================================================== */

export const YIELD = "RIBU_YIELD_VAL"
export type YIELD_T = typeof YIELD

export type YIELDABLE = YIELD_T | Ch<unknown> | Promise<unknown>

export type Gen<Rec = unknown, Ret = void> =
	Generator<YIELDABLE, Ret, Rec>

type GenFn< _Ports extends Ports = Ports, Args extends unknown[] = unknown[]> =
	(this: Prc & _Ports, ...args: Args) => Gen

type PrcState = "RUNNING" | "CANCELLING" | "DONE"
type ExecNext = "RESUME" | "PARK"

type onCancelFn = (...args: unknown[]) => unknown
type OnCancel = onCancelFn | GenFn

type Ports = {
	[K: string]: Ch<unknown>
}

type WithCancel<Ports> = Ports & Pick<Prc, "cancel">
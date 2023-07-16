import { all } from "./index.mjs"
import csp from "./initCsp.mjs"
import { ch, BaseChan, type Ch } from "./channel.mjs"


/* === Prc class ====================================================== */

export const YIELD = "RIBU_YIELD_VAL"
export type YIELD_T = typeof YIELD

export type YIELDABLE = YIELD_T | Ch<unknown> | Promise<unknown>

export type Gen<Rec = unknown> =
	Generator<YIELDABLE, void, Rec>

type GenFn<Args = unknown, Ports = unknown> =
	(this: Prc & Ports, ...args: Args[]) => Gen

type PrcState = "RUNNING" | "CANCELLING" | "DONE"
type ExecNext = "RESUME" | "PARK"

type onCancelFn = (...args: unknown[]) => unknown
type OnCancel = onCancelFn | GenFn

/**
 * The generator manager
 */
export class Prc<ChV = unknown> {

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

	onCancel?: OnCancel = undefined
	_deadline: number

	/** Setup by sleep(). Used by .cancel() to clearTimeout(_timeoutID) */
	_timeoutID?: NodeJS.Timeout = undefined

	done = ch<ChV>()

	/**
	 * @param {boolean} isUserPrc
		* Used to launch "special"/internal PrcS with _go(), which are used in
		* Prc.cancel(). These PrcS don't have children to auto cancel that
		* would create infinite loops of cancelling.
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

	cancel(): Ch {

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

function* finishNormalDone(prc: Prc) {

	prc._state = "DONE"

	const { done, _$childS } = prc

	// No need to put a deadline on auto canceling any active children because,
	// at instantiation, they have a shorter/equal deadline than this prc.
	// So just need for them to finish cancelling themselves
	if (_$childS && _$childS.size > 0) {
		yield cancelChildS(prc)
	}

	prc._parentPrc = undefined
	yield done.put()
}

function cancelChildS(prc: Prc, done = ch()) {

	const $childS = prc._$childS as Set<Prc>

	go(function* _cancelChildS() {
		let cancelChs = []  // eslint-disable-line prefer-const
		for (const prc of $childS) {
			cancelChs.push(prc.cancel())
		}
		yield all(...cancelChs)
		prc._$childS = undefined
		yield done.put()
	})

	return done
}

function nilParentRefAndMarkDONE(prc: Prc) {
	prc._state = "DONE"
	prc._parentPrc = undefined
}

function $onCancel(prc: Prc) {

	const done = ch()

	const $onCancel = go(function* $onCancel() {
		yield go(prc.onCancel as GenFn).done
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
		yield cancelChildS(prc, prc.done)
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
		const childSCancelDone = cancelChildS(prc)
		const onCancelDone = $onCancel(prc)
		yield all(childSCancelDone, onCancelDone)
		yield prc.done.put()
	})

	return prc.done
}



/* === Process (Prc) constructors ====================================================== */

// type Opt<TKs extends string, ChV = unknown> = {
// 	[K in TKs]:
// 		K extends keyof Prc ? never :
// 		K extends "deadline" ? number :
// 		Ch<ChV>
// }

type Opt<OptKs extends string> = {
	[k in OptKs]:
		// K extends keyof Prc ? never :
		// typeof k extends "deadline" ? number :
		Ch<unknown>
}

export function Go<GenArgs, OptKs extends string, _Opt extends Opt<OptKs>>(
	opt: _Opt,
	genFn: GenFn<GenArgs, _Opt>,
	...genFnArgs: GenArgs[]
): Prc & Ports {

	const deadline = opt && ("deadline" in opt) ? (opt.deadline) as number : undefined

	let prc = new Prc(true, deadline) as    (Prc & _Opt)  // eslint-disable-line prefer-const
	prc._genName = genFn.name

	if (opt) {
		for (const k in opt) {
			if (k === "deadline") continue
			const optsVal = opt[k]
			prc[k] = optsVal
		}
	}

	const gen = genFn.call(prc, ...genFnArgs)
	prc._gen = gen

	run(prc)
	return prc
}

const ports = {port: ch(), portStr: ch<string>()}
Go(ports, function*(str) {
	this.onCancel = function* () {}
	yield this.port.put()
	yield this.portStr.put(str)
}, "f")



export function go<Args>(genFn: GenFn<Args>, ...genFnArgs: Args[]): Proc {
	const prc = new Prc(true)
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
	const prc = new Prc(true)
	prc.onCancel = onCancel
	return prc
}


/** Used internally in Prc.cancel(). @todo: actually not used. Pending remove */
export function _go<TGenFnArgs>(genFn: GenFn<TGenFnArgs>, ...genFnArgs: TGenFnArgs[]): Proc {
	const prc = new Prc(false)
	prc._genName = genFn.name
	const gen = genFn.call(prc, ...genFnArgs)
	prc._gen = gen
	run(prc)
	return prc
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
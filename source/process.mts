import { all } from "./index.mjs"
import csp from "./initCsp.mjs"
import { ch, type Ch } from "./channel.mjs"


/* Promises:
	go(): just a way to track asyncFns for cancellation/bubble-error

*/



/* === Prc class ====================================================== */

export class Prc {

	/** undefined when instantiated in Cancellable  */
	_fn?: AsyncFn = undefined
	_fnName: string = ""

	_state: PrcState = "RUNNING"
	_promResolve?: <ChV>(msg: ChV) => void
	_chanPutMsg: unknown = -11  // special init value to be easily identifiable
	_onCancel?: OnCancel = undefined
	_deadline: number = csp.defaultDeadline

	/** For bubbling errors up (undefined for root prcS) */
	_parentPrc?: Prc = undefined
	/** For auto cancel child Procs */
	_$childS?: Set<Prc> = undefined

	_done = ch()

	constructor(parentPrc: Prc | undefined) {

		if (parentPrc) {

			this._parentPrc = parentPrc

			if (parentPrc._$childS === undefined) {
				parentPrc._$childS = new Set()
			}

			parentPrc._$childS.add(this)
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
		const { _done: done } = this

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
				(onCancel as PrcResume)()
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
				(onCancel as PrcResume)()
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

	get done() {
		return this._done.rec
	}
}

function* finishNormalDone(prc: Prc) {

	prc._state = "DONE"

	const { _done: done, _$childS } = prc

	// No need to put a deadline on auto canceling any active children because,
	// at instantiation, they have a shorter/equal deadline than this prc.
	// So just need for them to finish cancelling themselves
	if (_$childS && _$childS.size > 0) {
		yield go(cancelChildS, prc)._done
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
		yield go(prc._onCancel as GenFn)._done
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
	const { _done: done } = prc

	go(function* cancelChildSAndFinish() {
		yield go(cancelChildS, prc)._done
		yield done.put()
	})

	return done
}

function runChildSCancelAndOnCancel(prc: Prc) {

	go(function* _handleChildSAndOnCancel() {
		yield all(go(cancelChildS, prc)._done, $onCancel(prc))
		yield prc._done.put()
	})

	return prc._done
}



/* === Prc constructor ====================================================== */

export function go<Args extends unknown[]>(
	asyncFn: AsyncFn<Args>,
	...genFnArgs: Args
): Prc {

	const {stackHead, stackTail} = csp

	const newPrc = new Prc(stackHead)
	newPrc._fnName = asyncFn.name

	if (stackHead) {
		stackTail.push(stackHead)
	}

	csp.stackHead = newPrc

	const prom = asyncFn(...genFnArgs)    as ReturnType<typeof asyncFn>

	prom.then(
		res => {

		},
		rej => {

		}
	)

	csp.stackHead = stackTail.pop()

	return newPrc
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
	const runningPrc = csp.stackHead
	if (!runningPrc) {
		throw new Error(`ribu: can't call onCancel outside a process`)
	}
	runningPrc._onCancel = onCancel
}



/* === Helpers ====================================================== */

export function sleep(ms: number): Promise<void> {

	const runningPrc = csp.stackHead   as Prc

	return new Promise(resolve => {

		const timeoutID = setTimeout(function _sleepTimeOut() {

			if (runningPrc._state !== "RUNNING") {
				clearTimeout(timeoutID)
				return
			}

			csp.stackHead = runningPrc
			resolve()
		}, ms)
	})
}


/**
 * Wait for children procecesss to finish
 */
export function wait(...prcS: Prc[]): Ch {

	const allDone = ch()

	let doneChs: Array<Ch>

	if (prcS.length === 0) {

		const { stackHead: runningPrc } = csp
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
		doneChs = prcS.map(proc => proc._done)
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
		prcSDone.push(prc._done)
	}

	for (const chan of prcSDone) {

		go(function* _race() {

			const prcResult: unknown = yield chan

			// remove the winner prc from prcS so that the remainning can be cancelled
			prcS.splice(prcS.findIndex(prc => prc._done == chan), 1)

			go(function* () {
				yield cancel(...prcS)
			})

			yield done.put(prcResult)
		})

	}

	return done
}



/* === Types ====================================================== */

type PrcState = "RUNNING" | "CANCELLING" | "DONE"

type AsyncFn<Args extends unknown[] = unknown[]> =
	(...args: Args) => Promise<unknown>

type OnCancel = () => void | AsyncFn

type Ports = {
	[K: string]: Ch<unknown>
}

type WithCancel<Ports> = Ports & Pick<Prc, "cancel">
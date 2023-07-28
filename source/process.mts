import { ch, BaseChan, type Ch } from "./channel.mjs"
import { all } from "./index.mjs"
import { csp, getRunningPrcOrThrow } from "./initCsp.mjs"


/* === Prc class ====================================================== */

/**
 * The generator manager
 */
export class Prc {

	_gen: Gen
	_name: string
	_state: PrcState = "RUNNING"
	_chanPutMsg_m: unknown

	/** For bubbling errors up (undefined for root prcS) */
	_parentPrc?: Prc = undefined
	/** For auto cancel child Procs */
	_$childS?: Set<Prc> = undefined

	_timeoutID_m?: NodeJS.Timeout = undefined
	_onCancel_m?: OnCancel = undefined
	_deadline: number = csp.defaultDeadline

	done = ch()

	constructor(gen: Gen, genFnName: string = "") {
		this._gen = gen
		this._name = genFnName

		const { runningPrc } = csp
		if (runningPrc) {

			this._parentPrc = runningPrc

			if (runningPrc._$childS === undefined) {
				runningPrc._$childS = new Set()
			}

			runningPrc._$childS.add(this)
		}
	}

	setCancelDeadline(ms: number) {

		const { _parentPrc } = this

		if (_parentPrc) {
			const parentMS = _parentPrc._deadline
			ms = ms > parentMS ? parentMS : ms
		}

		this._deadline = ms
		return this
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

		const { _timeoutID_m, _$childS, _onCancel_m } = this

		if (_timeoutID_m) {
			clearTimeout(_timeoutID_m)
		}

		if (!_$childS && !_onCancel_m) {
			// void and goes to this.#finalCleanup() below
		}

		else if (!_$childS && isRegFn(_onCancel_m)) {
			_onCancel_m()
		}

		else if (!_$childS && isGenFn(_onCancel_m)) {
			yield* this.#$onCancel().rec
		}

		else if (_$childS && !_onCancel_m) {
			yield* cancelChildS(_$childS)
		}

		else if (_$childS && isRegFn(_onCancel_m)) {
			_onCancel_m()
			await cancelChildS(_$childS)
		}

		else {  /* _$child && isGenFn(_onCancel) */
			await Promise.allSettled([this.#$onCancel(), cancelChildS(_$childS!)])
		}

		this._state = "DONE"
		finalCleanup(this)
		resolveConcuCallers(this)
	}

	#$onCancel(): Ch {

		const done = ch()

		const $onCancel = go(async () => {
			await go(this._onCancel as AsyncFn).done
			hardCancel($deadline)
			await done.put()
		})

		const $deadline = go(async () => {
			await sleep(this._deadline)
			hardCancel($onCancel)
			await done.put()
		})

		return done
	}

	/** Since a new object is passed anyway, reuse the object for the api */
	ports<_P extends Ports>(ports: _P) {
		const prcApi_m = ports as WithCancel<_P>
		prcApi_m.cancel = this.cancel.bind(this)
		return prcApi_m
	}
}

export function resume(prc: Prc, msg?: unknown): void {
	if (prc._state !== "RUNNING") {
		return
	}

	csp.prcStack.push(prc)

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const { done, value } = prc._gen.next(msg)
		if (done === true) {
			go(finishNormalDone, prc, value)
			return
		}
		if (value === "PARK") break
		if (value === "RESUME") continue
		if (value instanceof Promise) {
			handleProm(value, prc)
			break
		}
		// if (value instanceof BaseChan) {
		// 	// @todo
		// }
	}

	csp.prcStack.pop()
}

function handleProm(prom: Promise<unknown>, prc: Prc) {
	prom.then(
		function onVal(val: unknown) {
			resume(prc, val)
		},
		function onErr(err: unknown) {
			// @todo implement errors
			throw err
		}
	)
}


function* finishNormalDone(prc: Prc, value) {
	csp.prcStack.pop()
	prc._state = "DONE"

	const { done, _$childS } = prc

	// No need to put a deadline on auto canceling any active children because,
	// at instantiation, they have a shorter/equal deadline than this prc.
	// So just need for them to finish cancelling themselves
	if (_$childS && _$childS.size > 0) {
		yield* go(cancelChildS, prc).done.rec
	}

	prc._parentPrc = undefined
	yield done.put()
}

function* cancelChildS(prc: Prc) {
	const $childS = prc._$childS!

	let cancelChs: Ch[] = []
	for (const prc of $childS) {
		cancelChs.push(prc.cancel())
	}
	yield* all(...cancelChs).rec
	prc._$childS = undefined
}

function nilParentRefAndMarkDONE(prc: Prc) {
	prc._state = "DONE"
	prc._parentPrc = undefined
}

function $onCancel(prc: Prc) {

	const done = ch()

	const $onCancel = go(function* $onCancel() {
		yield go(prc._onCancel_m as GenFn).done
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
	const timeoutID = prc._timeoutID_m
	if (timeoutID !== undefined) {
		clearTimeout(timeoutID)
		prc._timeoutID_m = undefined
	}
}

function runChildSCancelAndOnCancel(prc: Prc) {

	go(function* _handleChildSAndOnCancel() {
		yield all(go(cancelChildS, prc).done, $onCancel(prc))
		yield prc.done.put()
	})

	return prc.done
}


function isRegFn(fn?: OnCancel): fn is RegFn {
	return fn?.constructor.name === "Function"
}

const genCtor = function* () { }.constructor
function isGenFn(x: unknown): x is Gen {
	return x instanceof genCtor
}


/* === Prc constructor ====================================================== */

export function go<Args extends unknown[]>(genFn: GenFn<Args>, ...args: Args): Prc {
	const gen = genFn(...args)
	const prc = new Prc(gen, genFn.name)
	resume(prc)
	return prc
}


export function onCancel(onCancel: OnCancel): void {
	const runningPrc = csp.runningPrc
	if (!runningPrc) {
		throw Error(`ribu: can't use onCancel outside a process`)
	}
	runningPrc._onCancel_m = onCancel
}



/* === Helpers ====================================================== */

export function sleep(ms: number): "PARK" {
	const runningPrc = getRunningPrcOrThrow(`can't sleep() outside a process.`)

	const timeoutID = setTimeout(function _sleepTimeOut() {
		resume(runningPrc)
	}, ms)

	runningPrc._timeoutID_m = timeoutID
	return "PARK"
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

type PrcState = "RUNNING" | "CANCELLING" | "DONE"
export type Yieldable = "PARK" | "RESUME" | Promise<unknown>

export type Gen<Ret = unknown, Rec = unknown> =
	Generator<Yieldable, Ret, Rec>

type GenFn<Args extends unknown[] = unknown[]> =
	(...args: Args) => Gen

type onCancelFn = (...args: unknown[]) => unknown
type OnCancel = onCancelFn | GenFn

type Ports = {
	[K: string]: Ch<unknown>
}

type WithCancel<Ports> = Ports & Pick<Prc, "cancel">

type RegFn<Args extends unknown[] = unknown[]> =
	(...args: Args) => unknown
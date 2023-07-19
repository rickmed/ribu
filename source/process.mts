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

	_concurrentCancelPromResolvers?: Array<(x: void) => void> = undefined

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

	async cancel(): Promise<void> {

		const state = this._state

		if (state === "DONE") {
			return
		}

		if (state === "CANCELLING") {
			let resolve
			const prom = new Promise<void>(res => resolve = res)

			const {_concurrentCancelPromResolvers} = this
			if (_concurrentCancelPromResolvers === undefined) {
				this._concurrentCancelPromResolvers = []
			}

			this._concurrentCancelPromResolvers   !.push(resolve   !)
			return prom
		}

		this._state = "CANCELLING"

		const { _$childS, _onCancel } = this

		if (_$childS === undefined) {


			if (_onCancel) {
				const res = _onCancel()
				if (isProm(res)) {
					await onCancelWithDeadline(res  as Prom, this._deadline)
				}
			}
			finalCleanup(this)
		}
		else { /* has _$childS */

			if (_onCancel === undefined) {
				await cancelChildS(_$childS)
				return
			}

			const res = _onCancel()

			if (isProm(res)) {
				await runChildSCancelAndOnCancel(cancelChildS(_$childS), this._deadline, res   as Prom)
			}
			else {
				await cancelChildS(_$childS)
			}
			finalCleanup(this)
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

async function finishNormalDone(prc: Prc) {

	const { _$childS } = prc

	/**
	 * No need to put a deadline on auto canceling any active children because,
	 * at instantiation, they have a shorter/equal deadline than this prc.
	 * So just need for them to finish cancelling themselves
	 */
	if (_$childS) {
		await cancelChildS(_$childS)
		prc._$childS = undefined
	}

	finalCleanup(prc)
	resolveConcuCallers(prc)
}

function resolveConcuCallers(prc: Prc) {
	const {_concurrentCancelPromResolvers} = prc
	if (_concurrentCancelPromResolvers) {
		for (const resolve of _concurrentCancelPromResolvers) {
			resolve()
		}
	}
}

function cancelChildS($childS: Set<Prc>) {
	let cancelProms = []  // eslint-disable-line prefer-const
	for (const prc of $childS) {
		cancelProms.push(prc.cancel())
	}
	return Promise.allSettled(cancelProms)
}

function finalCleanup(prc: Prc) {
	prc._state = "DONE"
	if (prc._parentPrc) {
		prc._parentPrc._$childS?.delete(prc)
		prc._parentPrc = undefined
	}
}

// @todo: this function needs to be re-implemented when throw based cancellation
// is implemented. Right now, program will not end if there are pending
// callbacks inside promises inside onCancel()
function onCancelWithDeadline(onCancelProm: Prom, deadline: number) {

	let resolve
	const doneProm = new Promise<void>(res => resolve = res)
	let timeout
	let deadlineWon = false

	;(async function $onCancel() {
		await onCancelProm
		if (deadlineWon) return
		clearTimeout(timeout)
		resolve!()
	})()

	;(async function _deadline() {
		await new Promise<void>(res => {
			timeout = setTimeout(() => {
				res()
			}, deadline)
		})
		deadlineWon = true
		resolve!()
	})()

	return doneProm
}

async function runChildSCancelAndOnCancel(childsCancelProm: Prom<unknown>, deadline: number, onCancelProm: Prom) {
	const _onCancelProm = onCancelWithDeadline(onCancelProm, deadline)
	await Promise.allSettled([_onCancelProm, childsCancelProm])
}



/* === Prc constructor ====================================================== */

export function go<Args extends unknown[]>(
	asyncFn: AsyncFn<Args>,
	...genFnArgs: Args
): Prc {

	const {stackHead, stackTail} = csp

	const pcr = new Prc(stackHead)
	pcr._fnName = asyncFn.name

	if (stackHead) {
		stackTail.push(stackHead)
	}

	csp.stackHead = pcr

	const prom = asyncFn(...genFnArgs)    as ReturnType<typeof asyncFn>

	prom.then(
		() => {
			finishNormalDone(pcr)
		},
		//@todo: implement errors
	)

	csp.stackHead = stackTail.pop()

	return pcr
}


/**
 * A way to create a new Prc which sets it up as a child of last called go()
 * so the parent can child.cancel() and thus onCancel is ran.
 */
// export function Cancellable(onCancel: OnCancel) {
// 	const prc = new Prc()
// 	prc._onCancel = onCancel
// 	return prc
// }


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
export function cancel(...prcS: Prc[]): Prom<unknown> {
	const procCancelChanS = prcS.map(p => p.cancel())
	return Promise.allSettled(procCancelChanS)
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
	(...args: Args) => Prom<unknown>

type OnCancel =
	(() => unknown) | (() => Prom<unknown>)

type Prom<T = void> = Promise<T>


type Ports = {
	[K: string]: Ch<unknown>
}

type WithCancel<Ports> = Ports & Pick<Prc, "cancel">



/* === Helpers ====================================================== */

function isProm(x: unknown): boolean {
	if (x && typeof x === "object" && "then" in x && typeof x.then === "function") {
		return true
	}
	return false
}
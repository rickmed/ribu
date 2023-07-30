import { csp, getRunningPrcOrThrow } from "./initCsp.mjs"
import { ch, all, type Ch } from "./channel.mjs"

type ChRec<V = undefined> = Ch<V>["rec"]

/* === Prc class ====================================================== */

/**
 * The generator manager
 * @template Ret - The return type of the generator
 */
export class Prc<Ret = unknown> {

	#gen: Gen
	#name: string
	_state: PrcState = "RUNNING"

	#doneVal?: Ret = undefined
	#waitingDone?: Prc | Array<Prc> = undefined

	_chanPutMsg_m: unknown = undefined

	/** For bubbling errors up (undefined for root prcS) */
	#parent?: Prc = undefined
	/** For auto cancel child Procs */
	#childS?: Set<Prc> = undefined

	_sleepTimeoutID_m?: NodeJS.Timeout = undefined

	_onCancel_m?: OnCancel = undefined
	#lateCancelCallerChs_m: undefined | Ch[] = undefined

	#deadline: number = csp.defaultDeadline

	constructor(gen: Gen, genFnName: string = "") {
		this.#gen = gen
		this.#name = genFnName

		const { runningPrc } = csp
		if (runningPrc) {

			this.#parent = runningPrc

			if (runningPrc.#childS === undefined) {
				runningPrc.#childS = new Set()
			}

			runningPrc.#childS.add(this)
		}
	}

	_resume(msg?: unknown): void {

		if (this._state !== "RUNNING") {
			return
		}

		csp.prcStack.push(this)

		for (;;) {
			const { done, value } = this.#gen.next(msg)

			if (done === true) {
				this.#doneVal = value as Ret
				go(this.#finishNormalDone)
				return
			}
			if (value === "PARK") {
				break
			}
			if (value === "RESUME") {
				continue
			}
			if (value instanceof Promise) {
				value.then(
					(val: unknown) => {
						this._resume(val)
					},
					(err: unknown) => {
						// @todo implement errors
						throw err
					}
				)
				break
			}
		}

		csp.prcStack.pop()
	}

	*#finishNormalDone() {
		csp.prcStack.pop()
		this._state = "DONE"

		/**
		 * No need to timeout cancelling children because, at instantiation,
		 * they have a shorter/equal deadline than this (parent) prc.
		 * So just need for them to finish cancelling themselves.
		 */
		const { #childS: _$childS } = this
		if (_$childS) {
			yield* this.#cancelChildS(_$childS).rec
		}

		this.#finalCleanup()
		this.#resumeWaitingDone()
	}

	#resumeWaitingDone() {
		const prcS = this.#waitingDone
		if (!prcS) {
			return
		}
		else if (prcS instanceof Prc) {
			prcS._resume(this.#doneVal)
		}
		else {
			for (const prc of prcS) {
				prc._resume(this.#doneVal)
			}
		}
	}

	#cancelChildS($childS: Set<Prc>): Ch {
		let cancelChs: Ch[] = []
		for (const prc of $childS) {
			cancelChs.push(prc.cancel())
		}
		return all(...cancelChs)
	}

	#finalCleanup(): void {
		this.#childS = undefined
		const { #parentPrc: _parentPrc } = this
		if (_parentPrc) {
			_parentPrc._$childS?.delete(this)
			this.#parent = undefined
		}
	}

	#cancel_(): Ch {

		const {_state} = this

		if (_state === "DONE") {
			// @todo: implement a more efficient ch.resolve() to not create a whole temp process
			const _ch = ch()
			go(function* doneCancel() {
				yield _ch.put()
			})
			return _ch
		}

		if (_state === "CANCELLING") {
			const _ch = ch()
			if (!this.#lateCancelCallerChs_m) {
				this.#lateCancelCallerChs_m = []
			}
			this.#lateCancelCallerChs_m.push(_ch)
			return _ch
		}

		this._state = "CANCELLING"

		const {#childS: childS, _onCancel_m} = this

		this.#clearTimeout()

		if (!childS && !_onCancel_m) {
			// void and goes to this.#finalCleanup() below
		}

		else if (!childS && isRegFn(_onCancel_m)) {
			_onCancel_m()
		}

		else if (!childS && isGenFn(_onCancel_m)) {
			return this.#onCancelPrc()
		}

		else if (childS && !_onCancel_m) {
			yield * cancelChildS(childS)
		}

		else if (childS && isRegFn(_onCancel_m)) {
			_onCancel_m()
			yield cancelChildS(childS)
		}

		else {  /* _$child && isGenFn(_onCancel) */
			yield Promise.allSettled([this.#onCancelPrc(), cancelChildS(childS!)])
		}

		this._state = "DONE"
		this.#finalCleanup()
		this.#notifyLateCancelCallers()
	}

	#onCancelPrc(): Ch {

		const done = ch()
		const self = this

		const $onCancel = go(function* () {
			yield* go(self._onCancel_m as GenFn).done.rec
			hardCancel($deadline)
			yield done.put()
		})

		const $deadline = go(function* () {
			yield sleep(self.#deadline)
			hardCancel($onCancel)
			yield done.put()
		})

		return done

		function hardCancel(prc: Prc) {
			prc.#clearTimeout()
			prc.#finalCleanup()
		}
	}

	#clearTimeout(): void {
		const { _sleepTimeoutID_m: _timeoutID_m } = this
		if (_timeoutID_m) {
			clearTimeout(_timeoutID_m)
		}
	}

	*#done(receiverPrc: Prc): Gen<Ret> {

		const {#doneVal: _doneVal} = this
		if (_doneVal !== undefined) {
			return _doneVal
		}

		let waitingDone = this.#waitingDone

		if (waitingDone === undefined) {
			this.#waitingDone = receiverPrc
		}
		else if (waitingDone instanceof Prc) {
			this.#waitingDone = [waitingDone, receiverPrc]
		}
		else {
			waitingDone.push(receiverPrc)
		}

		const doneVal = yield "PARK"
		return doneVal as Ret
	}

	/** Public methods */

	get done(): Gen<Ret> {
		const receiverPrc = getRunningPrcOrThrow(`can't yield* done outside a process.`)
		return this.#done(receiverPrc)
	}

	cancel(): ChRec {
		return this.#cancel_().rec
	}

	ports<_P extends Ports>(ports: _P) {
		const prcApi_m = ports as WithCancel<_P>
		// Since a new object is passed anyway, reuse the object for the api
		prcApi_m.cancel = this.cancel.bind(this)
		return prcApi_m
	}

	setCancelDeadline(ms: number) {

		const { #parentPrc: _parentPrc } = this

		if (_parentPrc) {
			const parentMS = _parentPrc._deadline
			ms = ms > parentMS ? parentMS : ms
		}

		this.#deadline = ms
		return this
	}
}





function isRegFn(fn?: OnCancel): fn is RegFn {
	return fn?.constructor.name === "Function"
}

const genCtor = function* () { }.constructor
function isGenFn(x: unknown): x is Gen {
	return x instanceof genCtor
}

class OncePutBroadcastCh<V> {

	#cache?: V = undefined
	#waitingReceivers?: Prc | Array<Prc> = undefined

	emit(value: V) {

	}

	newReceiver() {
		const receiverPrc = getRunningPrcOrThrow(`can't yield* done outside a process.`)
		return this.#recGenFn(receiverPrc)
	}

	*#recGenFn(receiverPrc: Prc): Gen<Ret> {

		const {_doneVal} = this
		if (_doneVal !== undefined) {
			return _doneVal
		}

		let waitingDone = this._waitingDone_m

		if (waitingDone === undefined) {
			this._waitingDone_m = receiverPrc
		}
		else if (waitingDone instanceof Prc) {
			this._waitingDone_m = [waitingDone, receiverPrc]
		}
		else {
			waitingDone.push(receiverPrc)
		}

		const doneVal = yield "PARK"
		return doneVal as Ret
	}

}


/* ===  Prc constructor  ==================================================== */

export function go<Args extends unknown[]>(genFn: GenFn<Args>, ...args: Args): Prc {
	const gen = genFn(...args)
	const prc = new Prc(gen, genFn.name)
	prc._resume()
	return prc
}


export function onCancel(onCancel: OnCancel): void {
	const runningPrc = csp.runningPrc
	if (!runningPrc) {
		throw Error(`ribu: can't use onCancel outside a process`)
	}
	if (runningPrc._onCancel_m) {
		throw Error(`ribu: process onCancel is already set`)
	}
	runningPrc._onCancel_m = onCancel
}



/* ===  Helpers  ============================================================ */

export function sleep(ms: number): "PARK" {
	const runningPrc = getRunningPrcOrThrow(`can't sleep() outside a process.`)

	const timeoutID = setTimeout(function _sleepTimeOut() {
		runningPrc._resume()
	}, ms)

	runningPrc._sleepTimeoutID_m = timeoutID
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

	let prcSDone: Array<Ch> = []
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
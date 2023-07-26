import { all } from "./index.mjs"
import { csp, getRunningPrc } from "./initCsp.mjs"
import { ch, type Ch } from "./channel.mjs"


/**
 * No need to put a deadline on auto canceling any active children because,
 * at instantiation, they have a shorter/equal deadline than this prc.
 * So just need for them to finish cancelling themselves
 */

/* === Prc class ====================================================== */

export class Prc {

	_fnName: string = ""
	_state: PrcState = "RUNNING"

	/** The two below are used by channel operations */
	_promResolve?: PromResolve
	_chanPutMsg_m: unknown = 3  /** default val */

	/** Set by user with pubic api onCancel()  */
	_onCancel?: OnCancel = undefined

	/** Set in this.deadline() */
	_deadline: number = csp.defaultDeadline

	/** For bubbling errors up (undefined for root prcS) */
	_parentPrc?: Prc = undefined

	/** For auto cancel child Procs */
	_$childS?: Set<Prc> = undefined

	/** Where the result value of the prc is put */
	readonly _done = ch()

	/** Set by sleep(). Disposed if/at this.cancel() */
	_timeoutID?: NodeJS.Timeout

	/** Used if/when concurrent this.cancel() calls are made */
	cancelPromResolvers_m?: Array<(x: void) => void> = undefined

	constructor(parentPrc: Prc | undefined, fnName: string) {

		this._fnName = fnName

		if (parentPrc) {

			this._parentPrc = parentPrc

			if (parentPrc._$childS === undefined) {
				parentPrc._$childS = new Set()
			}

			parentPrc._$childS.add(this)
		}
	}

	get done() {
		return this._done.rec
	}

	ports<_P extends Ports>(ports: _P) {
		let _ports = ports as WithCancel<_P>
		_ports.cancel = this.cancel.bind(this)
		return _ports
	}

	setCancelDeadline(ms: number): this {

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

			// maybe channels are more perfomant than native proms
			// bc they are only thenables. So use channels here.
			// and return .rec to caller

			return new Promise<void>(resolve => {

				if (this.cancelPromResolvers_m === undefined) {
					this.cancelPromResolvers_m = []
				}

				this.cancelPromResolvers_m.push(resolve)
			})

		}

		this._state = "CANCELLING"

		const { _timeoutID, _$childS, _onCancel } = this

		if (_timeoutID) {
			clearTimeout(_timeoutID)
		}

		if (!_$childS && !_onCancel) {
			// void and goes to this.#finalCleanup() below
		}

		else if (!_$childS && isSyncFn(_onCancel)) {
			_onCancel()
		}

		else if (!_$childS && isAsyncFn(_onCancel)) {
			await this.#$onCancel().rec
		}

		else if (_$childS && !_onCancel) {
			await cancelChildS(_$childS)
		}

		else if (_$childS && isSyncFn(_onCancel)) {
			_onCancel()
			await cancelChildS(_$childS)
		}

		else {  /* _$child && isAsyncFn(_onCancel) */
			await Promise.allSettled([this.#$onCancel(), cancelChildS(_$childS!)])
		}

		this._state = "DONE"
		finalCleanup(this)
		resolveConcuCallers(this)
	}

	#cancel(): Ch {

		
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
}

async function finishNormal(prc: Prc): Promise<void> {

	/** Need to "consume" a runningPrc just as any ribu operation */
	csp.runningPrcS_m.pop()

	if (prc._state !== "RUNNING") {   // ie, is cancelling
		return
	}

	prc._state = "DONE"

	const { _$childS } = prc

	if (_$childS) {
		await cancelChildS(_$childS)
	}

	finalCleanup(prc)
}

function cancelChildS($childS: Set<Prc>) {
	let cancelProms = []
	for (const prc of $childS) {
		cancelProms.push(prc.cancel())
	}
	return Promise.allSettled(cancelProms)
}

function finalCleanup(prc: Prc) {
	prc._$childS = undefined
	const { _parentPrc } = prc
	if (_parentPrc) {
		_parentPrc._$childS?.delete(prc)
		prc._parentPrc = undefined
	}
}

function hardCancel(prc: Prc): void {
	const { _timeoutID } = prc
	if (_timeoutID) {
		clearTimeout(_timeoutID)
	}
	finalCleanup(prc)
}

function resolveConcuCallers(prc: Prc): void {
	const { cancelPromResolvers_m: cancelPromResolvers } = prc
	if (cancelPromResolvers) {
		for (const resolve of cancelPromResolvers) {
			resolve()
		}
	}
}

function isSyncFn(fn?: OnCancel): fn is RegFn {
	return fn?.constructor.name === "Function"
}

function isAsyncFn(fn?: OnCancel): fn is AsyncFn {
	return fn?.constructor.name === "AsyncFunction"
}

/* === Prc constructors ====================================================== */

export const go: Go = (fn, ...fnArgs) => {

	const parentPrc = csp.runningPrcS_m.at(-1)

	const prc = new Prc(parentPrc, fn.name)

	/**
	 * The new prc need to be set as first in the runningPrcS_m queue because it
	 * needs to be the runningPrc in the newly launched asyncFn. The ribu
	 * operations inside it pull it as if set from a chan/sleep operation
	 */
	csp.runningPrcS_m.push(prc)

	const prom = fn(...fnArgs) as ReturnType<typeof fn>

	prom.then(
		() => {
			finishNormal(prc)
		},
	)

	return prc
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



/* === Helpers ====================================================== */

export function sleep(ms: number): Promise<void> {

	let runningPrc = getRunningPrc(`can't use sleep() outside a process`)

	return new Promise<void>(resolveSleep => {

		const timeoutID = setTimeout(function sleepTimeOut() {
			csp.runningPrcS_m.unshift(runningPrc)
			resolveSleep()
		}, ms)

		runningPrc._timeoutID = timeoutID
	})
}


export function onCancel(onCancel: OnCancel): void {
	let runningPrc = getRunningPrc(`can't call onCancel outside a process`)
	runningPrc._onCancel = onCancel
}


/**
 * Wait for children procecesss to finish
 */
export function wait(...prcS: Prc[]): Ch {

	const allDone = ch()

	let doneChs: Array<Ch>

	if (prcS.length === 0) {

		const runningPrc = getRunningPrc(`can't use sleep() outside a process`)
		const { _$childS } = runningPrc

		if (_$childS === undefined) {
			return allDone
		}

		let prcDoneChs: Array<Ch> = []
		for (const prc of _$childS) {
			prcDoneChs.push(prc._done)
		}
		doneChs = prcDoneChs
	}
	else {
		doneChs = prcS.map(proc => proc._done)
	}

	go(async function _donePrc() {
		await all(...doneChs).rec
		await allDone.put()
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
export function race(...prcS: Prc[]): Ch<unknown> {

	const done = ch<unknown>()

	let prcSDone: Array<Ch> = []
	for (const prc of prcS) {
		prcSDone.push(prc._done)
	}

	for (const chan of prcSDone) {

		go(async function _race() {
			const winnerPrcRes: unknown = await chan.rec
			// the winnerPrc cancel the rest.
			await cancel(...prcS.filter(prc => prc._done != chan))
			await done.put(winnerPrcRes)
		})

	}

	return done
}



/* === Types ====================================================== */

type PrcState = "RUNNING" | "CANCELLING" | "DONE"

type Go<Args extends unknown[] = unknown[]> = (fn: AsyncFn<Args>, ...fnArgs: Args) => Prc

type AsyncFn<Args extends unknown[] = unknown[]> =
	(...args: Args) => Prom<unknown>

type RegFn<Args extends unknown[] = unknown[]> =
	(...args: Args) => unknown

type OnCancel = AsyncFn | RegFn

type Prom<V = void> = Promise<V>

type PromResolve = <V = void>(value: V) => void


type Ports = {
	[K: string]: Ch<unknown>
}

type WithCancel<Ports> = Ports & Pick<Prc, "cancel">

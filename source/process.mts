import { all } from "./index.mjs"
import csp from "./initCsp.mjs"
import { ch, getRunningPrc, type Ch } from "./channel.mjs"


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
	_chanPutMsg: unknown = 3  /** default val */

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
	cancelPromResolvers?: Array<(x: void) => void> = undefined

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

	get done(): Ch {
		return this._done
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

			return new Promise<void>(resolve => {

				if (this.cancelPromResolvers === undefined) {
					this.cancelPromResolvers = []
				}

				this.cancelPromResolvers.push(resolve)  // eslint-disable-line functional/immutable-data
			})

		}

		this._state = "CANCELLING"

		const { _timeoutID, _$childS, _onCancel } = this

		if (_timeoutID) {
			clearTimeout(_timeoutID)
		}

		if (!_$childS && !_onCancel) {
			// goes to this.#finalCleanup() below
		}

		else if (!_$childS && isRegFn(_onCancel)) {
			_onCancel()
		}

		else if (!_$childS && isAsyncFn(_onCancel)) {
			await this.#onCancel()
		}

		else if (_$childS && !_onCancel) {
			await cancelChildS(_$childS)
		}

		else if (_$childS && isRegFn(_onCancel)) {
			_onCancel(); await cancelChildS(_$childS)
		}

		else {  /* _$child && isAsyncFn(_onCancel) */
			await Promise.allSettled([this.#onCancel(), cancelChildS(_$childS!)])
		}

		finalCleanup(this)
		resolveConcuCallers(this)
	}

	#onCancel(): Ch {

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

async function finishNormalDone(prc: Prc): Promise<void> {

	const { _$childS } = prc

	if (_$childS) {
		await cancelChildS(_$childS)
	}

	finalCleanup(prc)
}

function cancelChildS($childS: Set<Prc>) {
	let cancelProms = []
	for (const prc of $childS) {
		cancelProms.push(prc.cancel())  // eslint-disable-line functional/immutable-data
	}
	return Promise.allSettled(cancelProms)
}

function finalCleanup(prc: Prc) {
	prc._state = "DONE"
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
	const { cancelPromResolvers } = prc
	if (cancelPromResolvers) {
		for (const resolve of cancelPromResolvers) {
			resolve()
		}
	}
}

function isRegFn(fn?: OnCancel): fn is RegFn {
	return fn?.constructor.name === "Function"
}

function isAsyncFn(fn?: OnCancel): fn is AsyncFn {
	return fn?.constructor.name === "AsyncFunction"
}

/* === Prc constructors ====================================================== */

export const go: Go = (fn, ...fnArgs) => {

	const { runningPrc, stackTail } = csp

	const pcr = new Prc(runningPrc, fn.name)

	if (runningPrc) {
		stackTail.push(runningPrc)
	}

	csp.runningPrc = pcr

	const prom = fn(...fnArgs) as ReturnType<typeof fn>

	/**
	 * To solve the problem of implicit chan receive as first asyncFn operation:
	 * .then() on the ch object is called asynchronously by means of await, so
	 * chan rec getter has no chance to get a reference to a runningPrc.
	 * So go() sets this microTask so that in case that an implicit receive is
	 * the first asyncFn operation, ch.then() and ch.rec inside it
	 * can get the reference.
	 * The other ribu async operations get their runningPrc references
	 * synchronously, so this has no effect on them.
	 */
	queueMicrotask(() => {
		csp.runningPrc = pcr
	})

	prom.then(
		() => {
			finishNormalDone(pcr)
		},
		//@todo: implement errors
	)

	csp.runningPrc = stackTail.pop()

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
	let runningPrc = getRunningPrc(`ribu: can't call onCancel outside a process`)
	runningPrc._onCancel = onCancel
}



/* === Helpers ====================================================== */

export function sleep(ms: number): Promise<void> {

	let runningPrc = getRunningPrc(`ribu: can't use sleep() outside a process`)

	return new Promise<void>(resolveSleep => {

		const timeoutID = setTimeout(function _sleepTimeOut() {
			queueMicrotask(() => {
				csp.runningPrc = runningPrc
				resolveSleep()
			})
		}, ms)

		runningPrc._timeoutID = timeoutID  // eslint-disable-line functional/immutable-data

	})
}



/**
 * Wait for children procecesss to finish
 */
export function wait(...prcS: Prc[]): Ch {

	const allDone = ch()

	let doneChs: Array<Ch>

	if (prcS.length === 0) {

		const runningPrc = getRunningPrc(`ribu: can't use sleep() outside a process`)
		const { _$childS } = runningPrc

		if (_$childS === undefined) {
			return allDone
		}

		let prcDoneChs: Array<Ch> = []
		for (const prc of _$childS) {
			prcDoneChs.push(prc.done)  // eslint-disable-line functional/immutable-data
		}
		doneChs = prcDoneChs
	}
	else {
		doneChs = prcS.map(proc => proc._done)
	}

	go(async function _donePrc() {
		await all(...doneChs)
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

	let prcSDone: Array<Ch> = []   // eslint-disable-line prefer-const
	for (const prc of prcS) {
		prcSDone.push(prc._done)  // eslint-disable-line functional/immutable-data
	}

	for (const chan of prcSDone) {

		go(async function _race() {
			const winnerPrcRes: unknown = await chan
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

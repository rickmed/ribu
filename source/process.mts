import { csp, getRunningPrcOrThrow } from "./initCsp.mjs"
import { ch, type Ch } from "./channel.mjs"

/* === Prc class ====================================================== */

/**
 * The generator manager
 * @template Ret - The return type of the generator
 */
export class Prc<Ret = unknown> {

	_gen: Gen
	_name: string
	_state: PrcState = "RUNNING"
	_parent?: Prc = undefined
	_childS?: Set<Prc> = undefined

	_returnVal?: Ret = undefined
	_waitingDone?: Ch<Ret> = undefined

	_chanPutMsg_m: unknown = undefined
	_sleepTimeout_m?: NodeJS.Timeout = undefined

	_onCancel_m?: OnCancel = undefined
	_waitingCancel?: Ch = undefined

	constructor(gen: Gen, genFnName: string = "") {
		this._gen = gen
		this._name = genFnName

		const { runningPrc } = csp
		if (runningPrc) {

			this._parent = runningPrc

			if (runningPrc._childS === undefined) {
				runningPrc._childS = new Set()
			}

			runningPrc._childS.add(this)
		}
	}

	/* BUGS:
	1) #finishNormalDone calls #finishNormalDone when done, recursive...
	2) #finishNormalDone is set up as _child of sub
		and so cancelled immediately bc sub was just done.

		- finishNormalDone should be a special Prc. What do it needs?
			- .resume(), nothing else

	A new Prc sets:
		- .resume() (which is called by rec/put)
		- sets child/parent in constructor. Why?
			- child to auto-cancel if parent done.
			- parent to remove myself from parent.child when done

	go():
		calls genFn, wraps in Prc, calls prc.resume()

	*/

	_resume(msg?: unknown): void {

		if (this._state !== "RUNNING") {
			return
		}

		csp.prcStack.push(this)

		for (; ;) {
			const { done, value } = this._gen.next(msg)

			if (done === true) {

				csp.prcStack.pop()

				if (this._name === "#finishNormalDone") return  // @todo: cleaner

				this._returnVal = value as Ret
				go(finishNormalDone, this, value as Ret)
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

	// @todo: need to route resutl of cancel() to .done.
	*#_cancel(prc: Prc, callingPrc: Prc): ChRec {

		const { _state } = this
		const waitingCancel = this._waitingCancel ??= ch()


		if (_state === "DONE") {
			// waitingCancel._addReceiver(receiverPrc)
			// can be in process of finisNormalDone
			waitingCancel._resumeAllWith(undefined)
			return
		}

		if (_state === "CANCELLING") {
			waitingCancel._addReceiver(callingPrc)
			return  // just needed to _addReceiver
		}

		this._state = "CANCELLING"
		this.#clearSleepTimeout()

		const onCancel = this._onCancel_m
		const childS = this._childS

		if (!childS && !onCancel) {
			// void and goes final cleanup below
		}

		else if (!childS && isRegFn(onCancel)) {
			onCancel()
		}

		else if (!childS && isGenFn(onCancel)) {
			yield* $onCancel(onCancel).rec
		}

		else if (childS && onCancel === undefined) {
			yield* cancel(...childS).rec
		}

		else if (childS && isRegFn(onCancel)) {
			onCancel()
			yield* cancel(...childS).rec
		}

		else {  /* _$child && isGenFn(_onCancel) */
			// @todo: maybe use wait(...) here
			yield* _all($onCancel(onCancel as GenFn), cancel(...childS!)).rec
		}

		this._state = "DONE"
		nilParentChildSRefs(this)
		return


		function $onCancel(onCancel: GenFn): Ch {
			const done = ch()
			go(function* () {
				yield* go(onCancel).done
				yield done.put()
			})
			return done
		}
	}


	#clearSleepTimeout(): void {
		const { _sleepTimeout_m } = this
		if (_sleepTimeout_m) {
			clearTimeout(_sleepTimeout_m)
		}
	}

	/** User methods */

	get done(): Gen<Ret> {
		const { _returnVal } = this
		if (_returnVal !== undefined) {
			return (function* () { return _returnVal })()  // eslint-disable-line require-yield
		}
		const waitingDone = this._waitingDone ??= ch()
		return waitingDone.rec
	}

	cancel(): ChRec {
		const receiverPrc = getRunningPrcOrThrow(`can't call cancel() outside a process.`)
		return this.#_cancel(receiverPrc)
	}

	ports<_P extends Ports>(ports: _P) {
		const prcApi_m = ports as WithCancel<_P>
		// Since a new object is passed anyway, reuse the object for the api
		prcApi_m.cancel = this.cancel.bind(this)
		return prcApi_m
	}
}


function* finishNormalDone(prc: Prc, prcRetVal: unknown) {
	prc._state = "DONE"

	const childS = prc._childS
	if (childS) {
		yield* cancel(...childS).rec
	}

	nilParentChildSRefs(prc)
	prc._waitingDone?._resumeAllWith(prcRetVal)
}

function nilParentChildSRefs(prc: Prc): void {
	prc._childS = undefined
	const parent = prc._parent
	if (parent) {
		parent._childS?.delete(prc)
		prc._parent = undefined
	}
}


function isRegFn(fn?: OnCancel): fn is RegFn {
	return fn?.constructor.name === "Function"
}

const genCtor = (function* () { }).constructor

function isGenFn(x: unknown): x is GenFn {
	return x instanceof genCtor
}

/** @todo: maybe abstract with cancel(...) */
function _all(...chanS: Ch[]): Ch {
	const nChanS = chanS.length
	const allDone = ch()
	let nDone = 0

	for (const chan of chanS) {
		go(function* __all() {
			yield* chan.rec
			nDone++
			if (nDone === nChanS) {
				yield allDone.put()
			}
		})
	}

	return allDone
}



/* ===  Public functions   ================================================== */

export function go<Args extends unknown[]>(genFn: GenFn<Args>, ...args: Args): Prc {
	const gen = genFn(...args)
	const prc = new Prc(gen, genFn.name)
	prc._resume()
	return prc
}

export function onCancel(userOnCancel: OnCancel): void {
	const runningPrc = csp.runningPrc
	if (!runningPrc) {
		throw Error(`ribu: can't use onCancel outside a process`)
	}
	if (runningPrc._onCancel_m) {
		throw Error(`ribu: process onCancel is already set`)
	}
	runningPrc._onCancel_m = userOnCancel
}

export function sleep(ms: number): "PARK" {
	const runningPrc = getRunningPrcOrThrow(`can't sleep() outside a process.`)

	const timeoutID = setTimeout(function _sleepTimeOut() {
		runningPrc._resume()
	}, ms)

	runningPrc._sleepTimeout_m = timeoutID
	return "PARK"
}

/**
 * Cancel several processes concurrently
 */
export function cancel(...prcS: Prc[]): Ch {
	const nPrcS = prcS.length
	const allDone = ch()
	let nDone = 0

	for (const prc of prcS) {
		go(function* _cancel() {
			yield* prc.cancel()
			nDone++
			if (nDone === nPrcS) {
				yield allDone.put()
			}
		})
	}

	return allDone
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

type ChRec<V = unknown> = Ch<V>["rec"]
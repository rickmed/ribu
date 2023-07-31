import { csp, getRunningPrcOrThrow } from "./initCsp.mjs"
import { ch, type Ch } from "./channel.mjs"


/* === Prc class ====================================================== */

/**
 * The generator manager
 * @template Ret - The return type of the generator
 */
export class Prc<Ret = unknown> {

	#gen: Gen
	#name: string
	_state: PrcState = "RUNNING"
	#parent?: Prc = undefined
	#childS?: Set<Prc> = undefined

	#waitingDone?: Ch<Ret> = undefined

	_chanPutMsg_m: unknown = undefined
	_sleepTimeout_m?: NodeJS.Timeout = undefined

	_onCancel_m?: OnCancel = undefined
	#deadline: number = csp.defaultDeadline
	#waitingCancel?: Ch = undefined

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
				go(this.#finishNormalDone, value as Ret)
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

	*#finishNormalDone(prcRetVal: Ret) {
		csp.prcStack.pop()
		this._state = "DONE"

		/**
		 * No need to timeout cancelling children because, at instantiation,
		 * they have a shorter/equal deadline than this (parent) prc.
		 * So just need for them to finish cancelling themselves.
		 */
		const childS = this.#childS
		if (childS) {
			yield* cancel(...childS).rec
		}

		this.#nilParentChildSRefs()
		this.#waitingDone?._resumeAllWith(prcRetVal)
	}

	#nilParentChildSRefs(): void {
		this.#childS = undefined
		const parent = this.#parent
		if (parent) {
			parent.#childS?.delete(this)
			this.#parent = undefined
		}
	}

	*#_cancel(receiverPrc: Prc) {

		const {_state} = this
		const waitingCancel = this.#waitingCancel ??= ch()

		waitingCancel._addReceiver(receiverPrc)

		if (_state === "DONE") {
			waitingCancel._resumeAllWith(undefined)
			return
		}

		if (_state === "CANCELLING") {
			return  // just needed to _addReceiver
		}

		this._state = "CANCELLING"
		this.#clearSleepTimeout()
		this.#nilParentChildSRefs()

		const onCancel = this._onCancel_m
		const childS = this.#childS

		if (!childS && !onCancel) {
			// void and goes to this.#finalCleanup() below
		}

		else if (!childS && isRegFn(onCancel)) {
			onCancel()
		}

		else if (!childS && isGenFn(onCancel)) {
			yield* this.#$onCancel().rec
		}

		else if (childS && !onCancel) {
			yield* cancel(...childS).rec
		}

		else if (childS && isRegFn(onCancel)) {
			onCancel()
			yield* cancel(...childS).rec
		}

		else {  /* _$child && isGenFn(_onCancel) */
			yield* _all(this.#$onCancel(), cancel(...childS!)).rec
		}

		this._state = "DONE"
		waitingCancel._resumeAllWith(undefined)
	}

	#$onCancel(): Ch {

		const done = ch()
		const self = this

		const $onCancel = go(function* () {
			yield* go(self._onCancel_m as GenFn).done
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
			prc._state = "DONE"
			prc.#clearSleepTimeout()
			prc.#nilParentChildSRefs()
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
		const waitingDone = this.#waitingDone ??= ch()
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

	setCancelDeadline(ms: number) {

		const parent = this.#parent

		if (parent) {
			const parentMS = parent.#deadline
			ms = ms > parentMS ? parentMS : ms
		}

		this.#deadline = ms
		return this
	}
}

function isRegFn(fn?: OnCancel): fn is RegFn {
	return fn?.constructor.name === "Function"
}

const genCtor = (function*(){}).constructor

function isGenFn(x: unknown): x is Gen {
	return x instanceof genCtor
}

function _all(...chanS: Ch[]): Ch {
   const nChanS = chanS.length
   const allDone = ch()
   let nDone = 0

   for (const chan of chanS) {
      go(function* _recChan() {
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
      go(function* _recChan() {
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
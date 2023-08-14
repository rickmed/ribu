import { csp, getRunningPrcOrThrow } from "./initCsp.js"
import { Ch, addReceiver } from "./channel.js"
import { E, Ether, EPrcCancelled } from "./errors.js"
import { PARK, RESUME, UNSET } from "./shared.js"
import { waitForDebugger } from "inspector"


// @todo: remove from parent when done


/*
	Need to break out runOnCancelAndChildSCancel out of cancelPrc
*/

type PrcRet<Prc_> = Prc_ extends Prc<infer Ret> ? Ret : never
type DoneVal<PrcRet> = PrcRet | EPrcCancelled | E<"Unknown">

export class Prc<Ret = unknown> {

	/**
	 * Used to:
	 *   - Cancel children recursively if prc is cancelled
	 *   - When genFn is done, detect if active children to await them
	*/
	_childS_m?: Set<Prc> = undefined

	/**
	 * When genFn is done, to remove myself from parent.childS
	*/
	_parent_m?: Prc = undefined

	#state: PrcState = "RUNNING"
	_chanPutMsg_m: unknown = undefined
	#doneCh?: Ch<unknown> = undefined
	_sleepTimeout_m?: NodeJS.Timeout = undefined
	_onCancel_m?: OnCancel = undefined
	#cancelCh?: Ch = undefined
	_doneVal_m: DoneVal<Ret> | UNSET = UNSET
	_internalPrc_m: boolean = false

	constructor(
		readonly gen: Gen,
		readonly _name?: string,
		readonly _args?: unknown[],
	) {}

	_resume(msg?: unknown): void {

		if (this.#state !== "RUNNING") {
			return
		}

		csp.prcStack.push(this)

		for (; ;) {

			try {
				var { done, value } = this._gen.next(msg)  // eslint-disable-line no-var
			}
			catch (thrown) {
				_go(handleThrownErr, this, thrown)
				return
			}

			if (done === true) {
				csp.prcStack.pop()
				if (this._internalPrc_m) return
				finishNormalDone(this, value)
				return
			}
			// @todo: implement yielding channels
			if (value === PARK) {
				break
			}
			if (value === RESUME) {
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

	/**
 * If a prc throws anywhere, its onCancel is ran (tried) and children are cancelled.
 * The result of that operation is placed in its done channel
 */
	*handleThrownErr(thrown: unknown) {
		this.#state = "DONE"
		// need to run own onCancel as well
		// need to cancel children and put in prc._doneVal_m collected results. Schema:
		// - OG stack trace.
		// - err :: message, name, stack
		/*
			tag: "Unknown"
			cause: {
				message, name, stack
			}
		*/
		// wrap the result in EUnkown ?
		// need to contruct ribu stack trace with args

		const res = yield* runOnCancelAndChildSCancel(prc)
		// const ribuStackTrace = need to iterate _childS and _parent.
		// should I include siblings in stack?

		// this is suppose to resume ._done waiters.
		this._doneVal = EOther(res)  // @todo: check if ts complains when creating a prc
	}

	// since prcS are being cancelled, the result must be available at .doneVal
	// so need to do those side effects here
	// return thing?
	// is it likely that user handles errors in onCancelFns?
	// maybe cancel(prcS) should return "ok" | Error
	*runOnCancelAndChildSCancel(): Gen<undefined | Error> {

		const onCancel = this._onCancel_m
		const childS = this._childS_m

		if (!childS && !onCancel) {
			return undefined
		}

		else if (!childS && isRegFn(onCancel)) {
			return try_(onCancel)
		}

		else if (!childS && isGenFn(onCancel)) {
			yield* go(onCancel)._done.rec
		}

		else if (childS && onCancel === undefined) {
			yield* cancel(...childS).rec
		}

		else if (childS && isRegFn(onCancel)) {
			const res = try_(onCancel)
			yield* cancel(...childS).rec
		}

		else {  /* _$child && isGenFn(_onCancel) */
			// @todo: maybe use wait(...) here
			// need to put this on ._doneVal
			yield* _all(go(onCancel as OnCancelGen)._done, cancelPrcS(...childS!)).rec
		}

		function try_(fn: RegFn) {
			try {
				fn()
				return undefined
			}
			catch (err) {
				return err as Error
			}
		}
	}

	*finishNormalDone(prcRetVal: unknown) {
		this.#state = "DONE"
		const childS = this._childS_m
		if (childS) {
			const res = yield* waitErr(childS)
		}
		// this is suppose to resume ._done waiters.
		this._doneVal = prcRetVal
	}

	get done() {
		// const doneCh = this.#doneCh ??= Ch<Ret>()  // eslint-disable-line functional/immutable-data
		// const _doneVal = this._doneVal_m
		// if (_doneVal === UNSET) {
		// 	return doneCh
		// }
		// return doneCh.resolve(_doneVal)
		return Ch<Ret>()
	}

	// set _doneVal(_doneVal: unknown) {
	// 	this._doneVal_m = _doneVal
	// 	this._doneCh?.resumeAll(_doneVal)
	// },

	// ports<_P extends Ports>(ports: _P) {
	// 	const prcApi_m = ports as WithCancel<_P>
	// 	// Since a new object is passed anyway, reuse the object for the api
	// 	prcApi_m.cancel = this.cancel.bind(this)
	// 	return prcApi_m
	// }
}



// @todo: optimize to yield ch
// If ._doneCh waiters, need to resolve them with ExcPrcCancelled or Exc<Unknown>
//
function* cancelPrc(prc: Prc): Gen<void> {

	const callingPrc = getRunningPrcOrThrow(`can't call cancel() outside a process.`)

	const { _state } = prc
	const waitingCancel = prc._cancelCh ??= Ch()

	if (_state === "DONE") {
		// can be runn
		// waitingCancel._addReceiver(receiverPrc)
		// can be in process of finisNormalDone ??
		waitingCancel.resumeAll(undefined)
		return undefined
	}

	if (_state === "CANCELLING") {
		addReceiver(waitingCancel, callingPrc)
		return undefined
	}

	prc._state = "CANCELLING"
	if (prc._sleepTimeout_m) clearTimeout(prc._sleepTimeout_m)

	const res = yield* runOnCancelAndChildSCancel(prc)

	prc._state = "DONE"
	return
}

function cancelPrcS(prcS: _Prc[]): unknown {
	// what should I return if there's an error cancelling a Prc?
	// should return a collection of all errors
	// (can't really do anything really at app layer, but log to see at Op layer)
	// what data structure?
	// put its result (whatever outcome) on prc._doneVal
	// then I can inspect?
	const nPrcS = prcS.length
	const allDone = Ch()
	let nDone = 0

	for (const prc of prcS) {
		go(function* _cancel() {
			yield* cancelPrc(prc) // is it more efficient to return a chn?
			nDone++
			if (nDone === nPrcS) {
				yield allDone.put()
			}
		})
	}

	return allDone
}


function isRegFn(fn?: OnCancel): fn is RegFn {
	return fn?.constructor.name === "Function"
}

const genCtor = (function* () { }).constructor

function isGenFn(x: unknown): x is GenFn {
	return x instanceof genCtor
}


// can explode and each cancelChilds too

//

/* $onCancel:
	* ._done should resolve to: PrcRet | Exc<"Unknown">
		* PrcRet is ignored though
	* can't be cancelled.
	* children?:
		if children explodes, need to track them it to construct nice stack.
*/


function _all(...chanS: Ch<unknown>[]): Ch {
	const nChanS = chanS.length
	const allDone = Ch()
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



/*
 * =====  Public functions  ====================================================
*/

export function go<Args extends unknown[], T = unknown>(genFn: GenFn<Args, T>, ...args: Args) {
	const gen = genFn(...args)
	const prc = new Prc<GenRet<typeof gen>>(gen, genFn.name, args)

	const parent = csp.runningPrc

	if (parent) {
		prc._parent_m = parent
		if (parent._childS_m === undefined) {
			parent._childS_m = new Set()
		}
		parent._childS_m.add(prc)
	}

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

export function sleep(ms: number): PARK {
	const runningPrc = getRunningPrcOrThrow(`can't sleep() outside a process.`)

	const timeoutID = setTimeout(function _sleepTimeOut() {
		resume(runningPrc)
	}, ms)

	runningPrc._sleepTimeout_m = timeoutID
	return PARK
}

/**
 * Cancel several processes concurrently
 * @todo: cancel() needs to put to prc.done PrcCancelledErr() or if err during cancellation
 */

// returns Map<prc, onCancelRetVal> | onCancelRetVal
export function* cancel(...prcS: _Prc[]) {
	yield cancelPrcS(prcS)
	return ch<void>() // who resumes this?
}


/* === Types ====================================================== */

type GenRet<Gen_> = Gen_ extends Generator<unknown, infer Ret> ? Ret : never


export type Yieldable = PARK | RESUME | Promise<unknown>

export type Gen<Ret = unknown, Rec = unknown> =
	Generator<Yieldable, Ret, Rec>

type GenFn<Args extends unknown[] = unknown[], T = unknown> =
	(...args: Args) => Generator<Yieldable, T>

type onCancelFn = (...args: unknown[]) => unknown
type OnCancel = onCancelFn | OnCancelGen
type OnCancelGen = () => Gen

// type Ports = {
// 	[K: string]: Ch<unknown>
// }

// type WithCancel<Ports> = Ports & Pick<Prc, "cancel">

type RegFn<Args extends unknown[] = unknown[]> =
	(...args: Args) => unknown

type PrcState = "RUNNING" | "CANCELLING" | "DONE"
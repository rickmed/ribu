import { csp, getRunningPrcOrThrow } from "./initCsp.js"
import { ch, addReceiver, type Ch } from "./channel.js"
import { E, EUnknown, EPrcCancelled } from "./errors.js"

/* BUGS:
	1) #finishNormalDone calls #finishNormalDone when done, recursive...
	2) #finishNormalDone is set up as _child of sub
		and so cancelled immediately bc sub was just done.

		- finishNormalDone should be a special Prc. What do it needs?
			- .resume(), nothing else

	A new Prc sets:
		- sets child/parent in constructor. Why?
			- child to auto-cancel if parent done.
			- parent to remove myself from parent.child when done

	go():
		calls genFn, wraps in Prc, calls prc.resume()
*/

export class PrcClass {
	// ports<_P extends Ports>(ports: _P) {
	// 	const prcApi_m = ports as WithCancel<_P>
	// 	// Since a new object is passed anyway, reuse the object for the api
	// 	prcApi_m.cancel = this.cancel.bind(this)
	// 	return prcApi_m
	// }
}



export function resume(prc: Prc, msg?: unknown): void {

	if (prc._state !== "RUNNING") {
		return
	}

	csp.prcStack.push(prc)

	for (; ;) {
		try {
			var { done, value } = prc.next(msg)  // eslint-disable-line no-var
		}
		catch (err) {
			handleThrownErr(prc, err instanceof Error ? err : Error("", {cause: err}))
		}

		if (done === true) {

			csp.prcStack.pop()

			if (prc._name === "#finishNormalDone") return  // @todo: cleaner

			finishNormalDone(prc, value)
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
					resume(prc, val)
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

function getDoneCh(prc: Prc) {
	return prc._doneCh ??= ch<PrcRet<Prc>>()
}

function handleThrownErr(prc: Prc, err: Error): void {
	prc._state = "DONE"
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
	prc._doneVal_m = EUnknown(err)  // @todo: check if ts complains when creating a prc

}

function finishNormalDone(prc: Prc, prcRetVal: unknown): void {
	prc._state = "DONE"
	// check if active childS to wait for them
	prc._doneVal_m = prcRetVal
}

function nilParentChildSRefs(prc: Prc): void {
	prc._childS = undefined
	const parent = prc._parent
	if (parent) {
		parent._childS?.delete(prc)
		prc._parent = undefined
	}
}

// @todo: optimize to yield ch
// If ._doneCh waiters, need to resolve them with ExcPrcCancelled or Exc<Unknown>
//
function* cancelPrc(prc: Prc): Gen<void> {

	const callingPrc = getRunningPrcOrThrow(`can't call cancel() outside a process.`)

	const { _state } = prc
	const waitingCancel = prc._cancelCh ??= ch()

	if (_state === "DONE") {
		// waitingCancel._addReceiver(receiverPrc)
		// can be in process of finisNormalDone ??
		waitingCancel.resumeReceivers(undefined)
		return undefined
	}

	if (_state === "CANCELLING") {
		addReceiver(waitingCancel, callingPrc)
		return undefined
	}

	prc._state = "CANCELLING"
	if (prc._sleepTimeout_m) clearTimeout(prc._sleepTimeout_m)

	const onCancel = prc._onCancel_m
	const childS = prc._childS

	if (!childS && !onCancel) {
		// void and goes final cleanup below
	}

	else if (!childS && isRegFn(onCancel)) {
		onCancel()
	}

	else if (!childS && isGenFn(onCancel)) {
		yield* go(onCancel)._done.rec
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
		// need to put this on ._doneVal
		yield* _all(go(onCancel as OnCancelGen)._done, cancelPrcS(...childS!)).rec
	}

	prc._state = "DONE"
	nilParentChildSRefs(prc)
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
	const allDone = ch()
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

type DoneVal<PrcRet> = PrcRet | EPrcCancelled | E<"Unknown">

type _Prc<Ret = unknown> = Gen<Ret, unknown> & {
	_chanPutMsg_m: unknown
	_doneVal_m?: DoneVal<Ret>
}

export type Prc<Ret = unknown> = _Prc<Ret> & {
	_name: string
	_state: "RUNNING" | "CANCELLING" | "DONE"
	_doneCh?: Ch<DoneVal<Ret>>
	/** Used remove prc from parent's childS when its done and for stack traces */
	_parent?: Prc
	/** Used to cancel children is prc is cancelled */
	_childS?: Set<Prc>
	_sleepTimeout_m?: NodeJS.Timeout
	_onCancel_m?: OnCancel
	_cancelCh?: Ch
	get _done(): ReturnType<typeof _doneGetter>
}


type PrcRet<Prc_> = Prc_ extends Prc<infer Ret> ? Ret : never

function _doneGetter(this: Prc) {
	const doneCh = this._doneCh ??= ch()  // eslint-disable-line functional/immutable-data
	const _doneVal = this._doneVal_m
	if (_doneVal !== undefined) {
		// @todo: optimize to yield ch + resumeReceivers()
		go(function* () {
			yield doneCh.put(_doneVal)
		})
	}
	return doneCh
}

function _doneSetter(this: Prc, _doneVal: unknown) {
	this._doneVal_m = _doneVal
	this._doneCh?.resumeReceivers(_doneVal)
	nilParentChildSRefs(this)
}

/*
 * =====  Public functions  ====================================================
*/

export function go<Args extends unknown[]>(genFn: GenFn<Args>, ...args: Args): Prc {

	let prc = genFn(...args) as Prc<GenFnRet<typeof genFn>>

	Object.defineProperty(Object.getPrototypeOf(prc), "_doneVal", {
		get: _doneGetter,
		set: _doneSetter
	})
	prc._chanPutMsg_m = undefined
	prc._doneVal_m = undefined
	prc._name = genFn.name
	prc._state = "RUNNING"
	prc._doneCh = undefined
	prc._childS = undefined
	prc._sleepTimeout_m = undefined
	prc._onCancel_m = undefined
	prc._cancelCh = undefined

	const parentPrc = csp.runningPrc
	if (parentPrc) {

		prc._parent = parentPrc

		if (parentPrc._childS === undefined) {
			parentPrc._childS = new Set()  // eslint-disable-line functional/immutable-data
		}

		parentPrc._childS.add(prc)
	}

	resume(prc)
	return prc
}


type GenFnRet<GenFn> =
	GenFn extends (...args: unknown[]) => Generator<unknown, infer Ret, unknown> ? Ret : never



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
		resume(runningPrc)
	}, ms)

	runningPrc._sleepTimeout_m = timeoutID
	return "PARK"
}

/**
 * Cancel several processes concurrently
 * @todo: cancel() needs to put to prc.done PrcCancelledErr() or if err during cancellation
 */
export function cancel(...prcS: _Prc[]): Ch<void> {
	// this should call cancelPrcS and return Ch<void> to End-User
}


/* === Types ====================================================== */

export type Yieldable = "PARK" | "RESUME" | Promise<unknown>

export type Gen<Ret = unknown, Rec = unknown> =
	Generator<Yieldable, Ret, Rec>

type GenFn<Args extends unknown[] = unknown[]> =
	(...args: Args) => Gen

type onCancelFn = (...args: unknown[]) => unknown
type OnCancel = onCancelFn | OnCancelGen
type OnCancelGen = () => Gen

// type Ports = {
// 	[K: string]: Ch<unknown>
// }

// type WithCancel<Ports> = Ports & Pick<Prc, "cancel">

type RegFn<Args extends unknown[] = unknown[]> =
	(...args: Args) => unknown

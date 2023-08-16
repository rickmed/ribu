import { csp, getRunningPrcOrThrow } from "./initCsp.js"
import { Ch, addReceiver } from "./channel.js"
import { E, Ether, EPrcCancelled } from "./errors.js"
import { PARK, RESUME, UNSET, genCtor } from "./utils.js"


// @todo: remove from parent's child and remove parent pointer when done

type PrcRet<Prc_> = Prc_ extends Prc<infer Ret> ? Ret : never
type DoneVal<PrcRet> = PrcRet | EPrcCancelled | E<"Unknown">

export class Prc<Ret = unknown> {

	constructor(readonly gen: Gen) {}
	name: string | undefined = undefined
	args: Array<unknown> | undefined = undefined
	state: PrcState = "RUNNING"

	/**
	 * A Set is needed since children can add/remove in arbitrary order
	 */
	childS: Set<Prc> | undefined = undefined
	parent: Prc | undefined = undefined

	chanPutMsg: unknown = undefined

	_doneVal: DoneVal<Ret> | UNSET = UNSET
	doneCh: BroadCastCh<unknown> | undefined = undefined

	sleepTimeout: NodeJS.Timeout | undefined = undefined
	onCancel: OnCancel | undefined = undefined
	cancelCh: Ch | undefined = undefined
	isInternalPrc: boolean = false

	get rec() {
		return this.done.rec
	}

	/**
	 * Use .done() directly for a faster alternative to .rec() (but needs manual typing)
	 */
	get done() {
		let doneCh = this.doneCh
		if (!doneCh) {
			doneCh = new BroadCastCh<Ret>()
		}
		else {
			doneCh.addReceiver()
		}

		const _doneVal = this._doneVal
		if (_doneVal === UNSET) {
			return doneCh
		}
		return doneCh.resolve(_doneVal)
	}



	get doneVal() {
		return this._doneVal
	}

	// ports<_P extends Ports>(ports: _P) {
	// 	const prcApi_m = ports as WithCancel<_P>
	// 	// Since a new object is passed anyway, reuse the object for the api
	// 	prcApi_m.cancel = this.cancel.bind(this)
	// 	return prcApi_m
	// }
}

export function resume(prc: Prc, msg?: unknown): void {

	if (prc.state !== "RUNNING") {
		return
	}

	csp.prcStack.push(prc)

	for (; ;) {

		try {
			var { done, value } = prc.gen.next(msg)  // eslint-disable-line no-var
		}
		catch (thrown) {
			_go(handleThrownErr, prc, thrown)
			return
		}

		if (done === true) {
			csp.prcStack.pop()
			if (prc.isInternalPrc) {
				return
			}
			_go(finishNormalDone, prc, value)
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

/**
* If a prc throws anywhere, its onCancel is ran (tried) and children are cancelled.
* The result of that operation is placed in its done channel
*/
function* handleThrownErr(prc: Prc, thrown: unknown) {
	prc.state = "DONE"
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
	prc._doneVal = EOther(res)  // @todo: check if ts complains when creating a prc
}

// since prcS are being cancelled, the result must be available at .doneVal
// so need to do those side effects here
// return thing?
// is it likely that user handles errors in onCancelFns?
// maybe cancel(prcS) should return "ok" | Error
function* runOnCancelAndChildSCancel(prc: Prc): Gen<undefined | Error> {

	const onCancel = prc.onCancel
	const childS = prc.childS

	if (!childS && !onCancel) {
		return undefined
	}

	else if (!childS && isRegFn(onCancel)) {
		return try_(onCancel)
	}

	else if (!childS && isGenFn(onCancel)) {
		yield* go(onCancel).done.rec
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
		yield* _all(go(onCancel as OnCancelGen).done, cancelPrcS(...childS!)).rec
	}

	// helpers
	function try_(fn: RegFn) {
		try {
			fn()
			return undefined
		}
		catch (err) {
			return err as Error
		}
	}

	function isRegFn(fn?: OnCancel): fn is RegFn {
		return fn?.constructor.name === "Function"
	}
	function isGenFn(x: unknown): x is GenFn {
		return x instanceof genCtor
	}
}

function* finishNormalDone(prc: Prc, prcRetVal: unknown) {
	prc.state = "DONE"
	const childS = prc.childS

	// if children active, await them and return whatever the prc returned
	// if children erred, resolve prc with err.
	if (childS) {
		const res = yield* waitErr(childS)
	}
	// this is suppose to resume ._done waiters.
	notifyDoneVal(prc, prcRetVal)
}

function notifyDoneVal(prc: Prc, doneVal: unknown) {
	prc._doneVal = doneVal
	prc.doneCh?.resumeReceivers(doneVal)
}


function* cancelPrc(prc: Prc): Gen<void> {

	const callingPrc = getRunningPrcOrThrow(`can't call cancel() outside a process.`)

	const { state: _state } = prc
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

	prc.state = "CANCELLING"
	if (prc.sleepTimeout) clearTimeout(prc.sleepTimeout)

	const res = yield* runOnCancelAndChildSCancel(prc)

	prc.state = "DONE"
	return
}

function cancelPrcS(prcS: Prc[]): unknown {

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


function anyDone<P extends Prc>(...prcS: P[]) {

	// need to add currentPrc as receiver to all prcS

	// return donePrc
}


function* $onCancel(prc: Prc) {

	const $onCancel = go(prc._onCancel)
	const res = yield race($onCancel, timeout(prc.deadline))
	if (res !== $onCancel) {
		hardCancel($onCancel)
	}

	return done
}


function timeout() {}
function race() {}  // use anyDone and cancel the rest.

/**
 * Resumes all (current) waiting receivers with the last resolved value.
 * Caches the value for late arriving receivers, but deletes it so the
 * next batch of receivers are resumed with a new resolved value.
 */
class BroadCastCh<V> {

	#waitingReceivers: Array<Prc> | Prc
	#val: V | UNSET = UNSET

	constructor() {
		const recPrc = getRunningPrcOrThrow(`can't receive outside a process.`)
		this.#waitingReceivers = recPrc
	}

	addReceiver() {
		const recPrc = getRunningPrcOrThrow(`can't receive outside a process.`)
		let waitingReceivers = this.#waitingReceivers
		if (waitingReceivers instanceof Prc) {
			this.#waitingReceivers = [recPrc, waitingReceivers]
		}
		else {
			waitingReceivers.push(recPrc)
		}
	}

	get rec(): Gen<V> {
		return this.#rec()
	}

	*#rec(): Gen<V> {
		const recPrc = getRunningPrcOrThrow(`can't receive outside a process.`)

		let putPrc = this._waitingPutters.deQ()

		if (!putPrc) {
			this._waitingReceivers.enQ(recPrc)
			const msg = yield PARK
			return msg as V
		}

		const {_enQueuedMsgs} = this
		if (!_enQueuedMsgs.isEmpty) {
			return _enQueuedMsgs.deQ()!
		}
		else {
			resume(putPrc)
			const msg = putPrc.chanPutMsg
			return msg as V
		}
	}

	resumeReceivers(msg: V): void {



		const _val = this.#val
		if (_val !== UNSET) {
			this.#val = UNSET
		}

//CONTINUE HERE: what if there are no receivers when this called?
		const {#waitingReceivers_m: waitingReceivers} = this
		while (!waitingReceivers.isEmpty) {
			const recPrc = waitingReceivers.deQ()!
			resume(recPrc, msg)
		}
		waitingReceivers.clear()
	}

	resolve(msg: V): this {
		this.#val = msg
		return this
	}
}




export function _go<Args extends unknown[], T = unknown>(genFn: GenFn<Args, T>, ...args: Args) {
	const gen = genFn(...args)
	let prc = new Prc<GenRet<typeof gen>>(gen)
	prc.isInternalPrc = true
	resume(prc)
	return prc
}


/*
 * =====  Public functions  ====================================================
*/

export function go<Args extends unknown[], T = unknown>(genFn: GenFn<Args, T>, ...args: Args) {
	const gen = genFn(...args)
	let prc = new Prc<GenRet<typeof gen>>(gen)
	prc.name = genFn.name
	prc.args = args

	let parent = csp.runningPrc
	if (parent) {
		prc.parent = parent
		if (parent.childS === undefined) {
			parent.childS = new Set()
		}
		parent.childS.add(prc)
	}

	resume(prc)
	return prc
}


export function onCancel(userOnCancel: OnCancel): void {
	let runningPrc = csp.runningPrc
	if (!runningPrc) {
		throw Error(`ribu: can't use onCancel outside a process`)
	}
	if (runningPrc.onCancel) {
		throw Error(`ribu: process onCancel is already set`)
	}
	runningPrc.onCancel = userOnCancel
}


export function sleep(ms: number): PARK {
	let runningPrc = getRunningPrcOrThrow(`can't sleep() outside a process.`)

	const timeoutID = setTimeout(function _sleepTimeOut() {
		resume(runningPrc)
	}, ms)

	runningPrc.sleepTimeout = timeoutID
	return PARK
}

/**
 * Cancel several processes concurrently
 * @todo: cancel() needs to put to prc.done PrcCancelledErr() or if err during cancellation
 */
export function* cancel(...prcS: Prc[]) {
	yield cancelPrcS(prcS)
	return Ch<void>() // who resumes this?
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
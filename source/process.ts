import { Ch, addRecPrcToCh, isCh } from "./channel.js"
// import { Name, err, ECancOK, EUncaught } from "./errors.js"
import { sys, getRunningPrc, theIterable, type TheIterable, theIterator, type TheIterator } from "./system.js"
import { ArraySet } from "./dataStructures.js"

type Status = "PARK" | "RESUME" | "FINISHING" | "DONE"

/**
 * A prc can be resolved with: genFnReturnType | ECancOK
 */
export class Prc<Ret = unknown> {

	_gen: Gen
	_isInternal?: true
	_status?: Status
	_IOmsg?: unknown
	_args?: unknown[]
	_name?: string

	/**
	 * A Set since children can be added/removed in arbitrary order
	 */
	_childS?: ArraySet<Prc>
	_parent?: Prc

	_observers?: Prc | Prc[]

	_onCancel?: OnCancel
	_sleepTimeout?: NodeJS.Timeout

	constructor(gen: Gen, internal?: true) {
		this._gen = gen
		if (internal) this._isInternal = true

		if (!internal) {
			let parent = sys.runningPrc
			if (parent) {
				this._parent = parent
				if (parent._childS === undefined) {
					parent._childS = new ArraySet()
				}
				parent._childS.add(this)
			}
		}
	}

	resume(IOmsg?: unknown): void {
		if (this._status === "DONE") {
			return
		}

		sys.prcStack.push(this)

		for (; ;) {
			this._setResume(IOmsg)
			// try {
				var yielded = this._gen.next()  // eslint-disable-line no-var
			// }
			// catch (thrown) {
			// 	console.log({thrown})
			// 	_go(this.#handleThrownErr, thrown)
			// 	return
			// }

			sys.prcStack.pop()
			if (yielded.done === true) {
				if (this._isInternal) {
					return
				}
				if (hasActiveChildS(this)) {
					_go(this._waitChildS.bind(this))
					return
				}
				this.#finishNormalDone(yielded.value)
				return
			}

			// done === false, ie, park
			return
		}

		//
		function hasActiveChildS(prc: Prc) {
			const childS = prc._childS
			if (childS && childS.length > 0) return true
			return false
		}
	}

	[Symbol.iterator](): TheIterator<Ret> {
		const runningPrc = getRunningPrc()
		// need to add this as child of runningPrc
		// in case parent is cancelled.
		const myStatus = this._status
		if (myStatus === "DONE") {
			runningPrc._setResume(this._IOmsg)
		}
		else {
			runningPrc._setPark()
			this._addObserver(runningPrc)
		}
		return theIterator
	}

	_addObserver(prc: Prc) {
		let observers = this._observers
		if (!observers) {
			this._observers = prc
		}
		else if (observers instanceof Prc) {
			this._observers = [observers, prc]
		}
		else {
			observers.push(prc)
		}
	}

	_resumeObservers() {
		const observers = this._observers
		if (!observers) {
			return
		}
		const msg = observers instanceof _Group ? this : this._IOmsg
		if (observers instanceof Prc) {
			observers.resume(msg)
		}
		else {
			for (const observer of observers) {
				observer.resume(msg)
			}
		}

		this._observers = undefined
	}

	_setPark(_IOmsg?: unknown) {
		this._status = "PARK"
		this._IOmsg = _IOmsg
	}

	_setResume(_IOmsg?: unknown) {
		this._status = "RESUME"
		this._IOmsg = _IOmsg
	}

	get val() {
		return this._IOmsg as Ret
	}

	// ports<_P extends Ports>(ports: _P) {
	// 	const prcApi_m = ports as WithCancel<_P>
	// 	// Since a new object is passed anyway, reuse the object for the api
	// 	prcApi_m.cancel = this.cancel.bind(this)
	// 	return prcApi_m
	// }


	/**
	 * If an error occurs during cancelling, the calling process is resolved
	 * with EUncaught ()
	 */

	cancel() {
		// needs to returns theIterable
		// add caller-runningPrc as observer
		// if I'm resolved, return the value (wether I'm cancelled or done already)
		const runningPrc = getRunningPrc()
		const myStatus = this._status
		if (myStatus === "DONE") {
			runningPrc._setResume(this._IOmsg)
		}

		// else, need to cancel my children in parallel

		return theIterator as Iterator<Ret>
	}

	/**
	 * @example
	 * const res = yield* prc.tryCancel(2000)
	 * if (err(res)) {
	 * 	...
	 * }
	 */
	*tryCancel(deadline?: number): true | EUncaught {
		const {_status} = this

		if (_status === "DONE") {  // late .cancel() callers.
			// can be runn
			// waitingCancel._addReceiver(receiverPrc)
			// can be in process of finisNormalDone ??
			waitingCancel.resumeAll(undefined)
			return undefined
		}

		if (_status === "CANCELLING") {
			addReceiver(waitingCancel, callingPrc)
			return undefined
		}

		this._status = "CANCELLING"
		const sleepTO = this[sleepTimeout]
		if (sleepTO) clearTimeout(sleepTO)

		const res = yield* runOnCancelAndChildSCancel(this)

		this._status = "DONE"
		return
	}

	#removeChild(prc: Prc) {
		this._childS?.delete(prc)
	}

	#finishNormalDone(doneVal: unknown) {
		this._status = "DONE"
		this._IOmsg = doneVal
		if (this._parent) {
			this._parent.#removeChild(this)
			this._parent = undefined
		}
		// no need to nil prc.childS since this function is called when no active children
		this._resumeObservers()
	}

	// @todo
	// should return
	/**
	 * (?) => do i need Group to concurrently wait for any of children to be done
	 *	 I'd need to subscribe to all of them
	 * Also, how to handle if a child throws while waitChildS* ?
	 * 	- maybe an additional state in prc? ie, when "WAITING_FOR_CHILDS",
	 *
	 */
	_waitChildS() {
	/* 	this._status = "FINISHING"
		const inFlight = new _Group(this._childS!)  // cast ok since this method is only called when childS
		while (inFlight.count) {
			const res = yield* inFlight.rec
			if (err(res)) {
				// this err can be a natural return value by childPrc, threw in body or was cancelled
				// if cancel returned exception I think I need to mangle all up in a "Something" Err
				const cancelRes = yield* inFlight.tryCancel()
				if (err(cancelRes)) {
					this._IOmsg = cancelRes
				}
				doneVal = res
			}
		}

		this._IOmsg = doneVal
		this._resumeObservers()
		return

	*/

		const childS = this._childS!  // cast ok since this method is only called when childS

		for (const child of childS) {
			child._addObserver(this)
		}

		// when child is done it will call this.resume()
		// when all childS are done, need to call this._resumeObservers()
			// and clean-up, I think

	}

	/**
	* If a prc throws anywhere, its onCancel is ran (tried) and children are cancelled.
	* The result of that operation is placed in its done channel
	*/
	*#handleThrownErr(prc: Prc, thrown: unknown) {
		prc._status = "DONE"


		const res = yield* runOnCancelAndChildSCancel(prc)
		// const ribuStackTrace = need to iterate _childS and _parent.
		// should I include siblings in stack?

		// this is suppose to resume ._done waiters.
		// prc._doneVal = EOther(res)  // @todo: check if ts complains when creating a prc
	}
}








// since prcS are being cancelled, the result must be available at .doneVal
// so need to do those side effects here
// return thing?
// is it likely that user handles errors in onCancelFns?
// maybe cancel(prcS) should return "ok" | Error
// function* runOnCancelAndChildSCancel(prc: Prc): Gen<undefined | Error> {

// 	const onCancel = prc.onCancel

// 	const childS = prc.#childS
// 	if (!childS && !onCancel) {
// 		return undefined
// 	}

// 	else if (!childS && isRegFn(onCancel)) {
// 		return try_(onCancel)
// 	}

// 	else if (!childS && isGenFn(onCancel)) {
// 		yield* go(onCancel).done.rec
// 	}

// 	else if (childS && onCancel === undefined) {
// 		yield* cancel(...childS).rec
// 	}

// 	else if (childS && isRegFn(onCancel)) {
// 		const res = try_(onCancel)
// 		yield* cancel(...childS).rec
// 	}

// 	else {  /* _$child && isGenFn(_onCancel) */
// 		// @todo: maybe use wait(...) here
// 		// need to put this on ._doneVal
// 		yield* _all(go(onCancel as OnCancelGen).done, tryCancel(...childS!)).rec
// 	}

// 	// helpers
// 	function try_(fn: RegFn) {
// 		try {
// 			fn()
// 			return undefined
// 		}
// 		catch (err) {
// 			return err as Error
// 		}
// 	}

// 	function isRegFn(fn?: OnCancel): fn is RegFn {
// 		return fn?.constructor.name === "Function"
// 	}
// 	function isGenFn(x: unknown): x is GenFn {
// 		return x instanceof genCtor
// 	}
// }








function* $onCancel(prc: Prc) {

	const $onCancel = go(prc._onCancel)
	const wonPrc: Prc = yield* Group($onCancel, Timeout.new(prc.deadline)).rec
	if (wonPrc === Timeout) {
		// @todo $onCancel can fail, need to check p
		hardCancel($onCancel)
	}
}




function timeout(ms: number): Prc<void> {
	return go(function* () {
		yield sleep(ms)
	})
}


export function _go<Args extends unknown[], T>(genFn: GenFn<T, Args>, ...args: Args) {
	const gen = genFn(...args)
	let prc = new Prc<GenFnRet<typeof genFn>>(gen, true)
	prc.resume(undefined)
	return prc
}


/*
 * =====  Public functions  ====================================================
*/

export function go<Args extends unknown[], T>(genFn: GenFn<T, Args>, ...args_: Args) {
	const gen = genFn(...args_)
	let prc = new Prc<GenFnRet<typeof genFn>>(gen)
	prc._args = args_
	prc._name = genFn.name
	prc.resume()
	return prc
}


export function onCancel(userOnCancel: OnCancel): void {
	let runningPrc = getRunningPrc()
	if (runningPrc._onCancel) {
		throw Error(`ribu: process onCancel is already set`)
	}
	runningPrc._onCancel = userOnCancel
}


// @todo
// function fromProm(prom) {
// 	prom
// 		.then((val: unknown) => { this._resume(val) })
// 		.catch((err: unknown) => { /* @todo */ })
// }


/**
 * Cancel several processes concurrently
 * @todo: cancel() needs to put to prc.done PrcCancelledErr() or if err during cancellation
 */
export function* cancel(prcS: Prc[] | Prc) {
	yield tryCancel(prcS)
	return Ch<void>() // who resumes this?
}


/* ====  Group  ==== */

export function Group<PrcS extends Set<Prc>>(prcS: PrcS): _Group<(PrcS)[number]> {
	return new _Group<(PrcS)[number]>(prcS)
}

/**
 * @todo: consider a more effient #observed data structure
 */
class _Group<V> {

	_observed: Set<Prc>
	_observer: Prc

	constructor(toObserve?: Set<Prc>) {
		const observer = getRunningPrc()
		if (toObserve === undefined) {
			this._observed = new Set()
			return
		}
		this._observer = observer
		if (toObserve instanceof Set) {
			this._observed = toObserve
		}
		else {
			for (const prc of toObserve) {
				this._observed.add(prc)
			}
		}
		for (const prc of toObserve) {
			prc._addObserver(observer)
		}
	}

	go(...args: Parameters<typeof go>) {
		const prc = go(...args)
		this._observed.add(prc)
		return this
	}

	add(prc: Prc) {
		// need to add thisGroup as obs
		this._observed.add(prc)
		return this
	}

	cancel() {
		const observed = this._observed
		// need to cancel observed in parallel
		// would need to

	}

	tryCancel() {

	}

	pluck(prcOrFn: Prc | ((prc: Prc) => boolean)): Prc | Prc[] | undefined {
		const observed = this._observed
		if (typeof prcOrFn === "function") {
			let prcArr = []
			for (const prc of observed) {
				if (prcOrFn(prc)) prcArr.push(prc)
			}
			return prcArr
		}
		const hadPrc = this._observed.delete(prcOrFn)
		if (hadPrc) return prcOrFn
		return undefined
	}

	get rec() {
		return theIterable as TheIterable<V>
	}

	get count() {
		return this._observed.size
	}

	resume(observed: Prc) {
		// ignore if observed resolved with ECancOK
		this._observed.delete(observed)
		if (this._resumeObserverWithPrc === true) {
			this._observer.resume(observed)
		}
		else {
			this._observer.resume(observed[IOmsg])
		}
	}
}



/* ===  Types  ============================================================== */

export type Yieldable = PARK | RESUME | Promise<unknown>

export type Gen<Ret = unknown, Rec = unknown> =
	Generator<Yieldable, Ret, Rec>

type GenFn<T = unknown, Args extends unknown[] = unknown[]> =
	(...args: Args) => Generator<Yieldable, T>


type GenRet<Gen_> =
	Gen_ extends
	Gen<unknown, infer Ret> ? Ret
	: never

type GenFnRet<GenFn> =
	GenFn extends
	(...args: any[]) => Generator<unknown, infer Ret> ? Ret
	: never





type onCancelFn = (...args: unknown[]) => unknown
type OnCancel = onCancelFn | OnCancelGen
type OnCancelGen = () => Gen

// type Ports = {
// 	[K: string]: Ch<unknown>
// }

// type WithCancel<Ports> = Ports & Pick<Prc, "cancel">

type RegFn<Args extends unknown[] = unknown[]> =
	(...args: Args) => unknown



type PrcRet<Prc_> = Prc_ extends Prc<infer Ret> ? Ret : never
type DoneVal<PrcRet> = PrcRet | EPrcCancelled | E<"Unknown">

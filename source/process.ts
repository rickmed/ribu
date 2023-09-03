import { Ch, addRecPrcToCh, isCh } from "./channel.js"
import { E, err, ECancOK, EUncaught } from "./errors.js"
import { sys, getRunningPrc, theIterable, type TheIterable, theIterator } from "./initSystem.js"


type Status = "PARK" | "RESUME" | "CANCELLING" | "DONE"
export const status = Symbol("status")
export const IOmsg = Symbol("IOmsg")
const args = Symbol("args")
const name = Symbol("name")
const oncancel = Symbol("onCancel")
export const sleepTimeout = Symbol("sleepTO")

export class Prc<Ret = unknown> {

	#gen: Gen
	#internal?: true
	;[status]?: Status
	;[IOmsg]?: unknown
	;[args]?: unknown[]
	;[name]?: string

	/**
	 * A Set is needed since children can add/remove in arbitrary order
	 */
	#childS?: Set<Prc>
	#parent?: Prc

	#observers?: Prc | Array<Prc>

	;[oncancel]?: OnCancel
	;[sleepTimeout]?: NodeJS.Timeout

	constructor(gen: Gen, internal?: true) {
		this.#gen = gen
		if (internal) this.#internal = true

		if (!internal) {
			let parent = sys.runningPrc
			if (parent) {
				this.#parent = parent
				if (parent.#childS === undefined) {
					parent.#childS = new Set()
				}
				parent.#childS.add(this)
			}
		}
	}

	[Symbol.iterator]() {
		const status_ = this[status]
		if (status_ === "DONE") {
			return theIterator as Iterator<Ret>
		}
		this._subscribeRunning()
		getRunningPrc()._setPark()
		return theIterator as Iterator<Ret>
	}

	_subscribeRunning() {
		let observer = getRunningPrc()
		let observers = this.#observers
		if (!observers) {
			this.#observers = observer
		}
		else if (observers instanceof Prc) {
			this.#observers = [observers, observer]
		}
		else {
			observers.push(observer)
		}
	}

	resume(IOmsg?: unknown): void {
		if (this[status] === "DONE") {
			return
		}

		sys.prcStack.push(this)

		for (; ;) {
			this._setResume(IOmsg)
			var y = this.#gen.next()  // eslint-disable-line no-var
			// try {
			// }
			// catch (thrown) {
			// 	console.log({thrown})
			// 	_go(this.#handleThrownErr, thrown)
			// 	return
			// }

			sys.prcStack.pop()
			if (y.done === true) {
				if (this.#internal) {
					return
				}
				// if (hasActiveChildS(this)) {
				// 	_go(this.#waitChildS)
				// 	return
				// }
				this.#finishNormalDone(y.value)
				return
			}

			// done === false, ie, park
			return
		}


		// helpers
		function hasActiveChildS(this_: Prc) {
			const childS = this_.#childS
			if (!childS || childS.size === 0) return false
			return true
		}
	}

	_setPark(_IOmsg?: unknown) {
		this[status] = "PARK"
		this[IOmsg] = _IOmsg
	}

	_setResume(_IOmsg?: unknown) {
		this[status] = "RESUME"
		this[IOmsg] = _IOmsg
	}

	get doneVal() {
		return this[IOmsg] as Ret
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

		const doneCh = Ch<void>()
		const callingPrc = getRunningPrc()

		_go(function* () {
			const res = yield this.tryCancel()
			if (err(res)) {
				// need to cancel callingPrc's children and resolve it with err
				callingPrc.cancel() //??
			}
		})

		return doneCh
	}

	/**
	 * @example
	 * const res = yield* prc.tryCancel(2000)
	 * if (err(res)) {
	 * 	...
	 * }
	 */
	*tryCancel(deadline?: number): true | EUncaught {
		const _status = this[status]

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

		this[status] = "CANCELLING"
		const sleepTO = this[sleepTimeout]
		if (sleepTO) clearTimeout(sleepTO)

		const res = yield* runOnCancelAndChildSCancel(this)

		this[status] = "DONE"
		return
	}

	/* Called when prc is normal done, or done cancelling */
	#resumeObservers() {
		const observers = this.#observers
		if (!observers) {
			return
		}
		else if (observers instanceof Prc) {
			const msg = observers instanceof _Group ? this : this[IOmsg]
			observers.resume(msg)
		}
		else {
			for (const observer of observers) {
				const msg = observer instanceof _Group ? this : this[IOmsg]
				observer.resume(msg)
			}
		}

		this.#observers = undefined
	}

	#finishNormalDone(doneVal: unknown) {
		this[status] = "DONE"
		this[IOmsg] = doneVal
		if (this.#parent) {
			this.#parent.#childS?.delete(this)
		}
		this.#parent = undefined
		// no need to prc.childS = undefined since this function is called when no active children
		this.#resumeObservers()
	}

	*#waitChildS() {
		this[status] = "DONE" // concurrent cancelling ??
		// cast ok. this fn is only called when childS !== undefined
		const childS = [...this.#childS!]

		const doneCh = any(childS)

		let doneVal

		while (doneCh.notDone) {  // eslint-disable-line
			const res = yield* doneCh.rec

			if (err(res)) {

				// ok so a child just return an Exc
				// if cancel returned exception I think I need to mangle all up in a "Something" Err

				const cancelRes = yield tryCancel(childS)
				if (err(cancelRes)) {
					this[IOmsg] = cancelRes
				}
				doneVal = res
			}
		}

		this[IOmsg] = doneVal
		this.#resumeObservers()
		return
	}

	/**
	* If a prc throws anywhere, its onCancel is ran (tried) and children are cancelled.
	* The result of that operation is placed in its done channel
	*/
	*#handleThrownErr(prc: Prc, thrown: unknown) {
		prc[status] = "DONE"


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
	prc[args] = args_
	prc[name] = genFn.name
	prc.resume()
	return prc
}


export function onCancel(userOnCancel: OnCancel): void {
	let runningPrc = getRunningPrc()
	if (runningPrc.onCancel) {
		throw Error(`ribu: process onCancel is already set`)
	}
	runningPrc.onCancel = userOnCancel
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

type PrcRetUnion<T> = T extends Prc<infer U>[] ? U : never

export function Group<PrcS extends Prc[]>(prcS?: PrcS): _Group<PrcRetUnion<PrcS>> {
	return new _Group<PrcRetUnion<PrcS>>(prcS)
}

export function GroupPrc<PrcS extends Prc[]>(prcS: PrcS): _Group<(PrcS)[number]> {
	return new _Group<(PrcS)[number]>(prcS, true)
}

/* Group could inspect the value that the observed resume the observer with
	so it does not resume the observer if observed resolves with ECancOK
	Also, in GroupPrc I can have a flag to resume observers with Prc or prc.doneVal.
	_Group can subscribe to all observables and retransmit msg

*/

/**
 * @todo: provide a more effient #observed data structure
 */
class _Group<V> {

	#observed = new Set<Prc>()
	#observer: Prc
	#resumeObserverWithPrc?: boolean

	constructor(toObserveS?: Prc[], resumeWithPrc?: true) {
		this.#observer = getRunningPrc()
		if (toObserveS) {
			for (const prc of toObserveS) {
				this.#observed.add(prc)
			}
		}
		if (resumeWithPrc) this.#resumeObserverWithPrc = resumeWithPrc
	}

	go(prc: Prc) {
		this.#observed.add(prc)
		// ...
	}

	cancel() {
		//...
	}

	get rec() {
		return theIterable as TheIterable<V>
	}

	get count() {
		return this.#observed.size
	}

	get notDone() {
		if (this.#observed.size === 0) return false
		return true
	}

	resume(observed: Prc) {
		if (this.#resumeObserverWithPrc === undefined) {
			this.#observer.resume(observed)
		}
		else {
			this.#observer.resume(observed[IOmsg])
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

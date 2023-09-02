import { Ch, addRecPrcToCh, isCh } from "./channel.js"
import { E, err, ECancOK, EUncaught } from "./errors.js"
import { sys, getRunningPrc, iterRes } from "./initSystem.js"

type PrcIterator<PrcRet> = {
	next(): IteratorResult<unknown, PrcRet>
}

let yieldedPrc: Prc

const thePrcIterator = {
	next(): IteratorResult<unknown> {
		// @todo: need to add runningPrc as waiter to thisPrc
		if (yieldedPrc[status] !== "DONE") {
			iterRes.done = false
			// same iterRes.value bc will be ignored by yield*
			return iterRes
		}
		iterRes.done = true
		iterRes.value = yieldedPrc.doneVal
		return iterRes
	}
}

export const status = Symbol()
type Status = "RESUME_WITH_VAL" | "RESUME_WITH_PRC" | "PARK" | "CANCELLING" | "DONE"
export const IOmsg = Symbol("IOmsg")
const args = Symbol("args")
const name = Symbol("name")
const onCancelK = Symbol("onCancel")
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

	#waitingReceivers?: Prc | Array<Prc>

	;[onCancelK]?: OnCancel
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
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		yieldedPrc = this
		return thePrcIterator as PrcIterator<Ret>
	}

	resume(msg: unknown): void {

		if (this[status] === "DONE") {
			return
		}

		this[status] = "RESUME_WITH_VAL"
		this[IOmsg] = msg

		sys.prcStack.push(this)

		for (; ;) {

			try {
				var { done, value } = this.#gen.next()  // eslint-disable-line no-var
			}
			catch (thrown) {
				console.log({thrown})
				_go(this.#handleThrownErr, thrown)
				return
			}

			sys.prcStack.pop()
			if (done === true) {
				if (this.#internal) {
					return
				}
				// if (hasActiveChildS(this)) {
				// 	_go(this.#waitChildS)
				// 	return
				// }
				this.#finishNormalDone(value)
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

	_park(msg: unknown) {
		this[status] = "PARK"
		this[IOmsg] = msg
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
		// return PARK

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

	_addReceiver(resumeWith: Status) {
		let recPrc = getRunningPrc()
		recPrc[status] = resumeWith

		let waitingReceivers = this.#waitingReceivers

		if (!waitingReceivers) {
			this.#waitingReceivers = recPrc
		}
		else if (waitingReceivers instanceof Prc) {
			this.#waitingReceivers = [waitingReceivers, recPrc]
		}
		else {
			waitingReceivers.push(recPrc)
		}
	}

	#resumeReceivers() {
		const waitingReceivers = this.#waitingReceivers

		if (!waitingReceivers) {
			return
		}
		else if (waitingReceivers instanceof Prc) {
			resumeRecPrc(waitingReceivers, this)
		}
		else {
			for (const recPrc of waitingReceivers) {
				resumeRecPrc(recPrc, this)
			}
		}

		this.#waitingReceivers = undefined

		// helpers
		function resumeRecPrc(recPrc: Prc, this_: Prc) {
			const resumeRecPrcWith = recPrc[status]

			const msg =
				resumeRecPrcWith === "RESUME_WITH_VAL" ? this_[IOmsg] :
				resumeRecPrcWith === "RESUME_WITH_PRC" ? this_ :
				undefined

			recPrc.resume(msg)
		}
	}

	#finishNormalDone(doneVal: unknown) {

		this[status] = "DONE"
		this[IOmsg] = doneVal
		if (this.#parent) {
			this.#parent.#childS?.delete(this)
		}
		this.#parent = undefined
		// no need to prc.childS = undefined since this function is called when no active children
		this.#resumeReceivers()
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
		this.#resumeReceivers()
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
	const wonPrc: Prc = yield* _any($onCancel, Timeout.new(prc.deadline)).rec
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
	let prc = new Prc<GenFnRet<typeof genFn>>(gen, false)
	prc[args] = args_
	prc[name] = genFn.name
	prc.resume(undefined)
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


/* ====  any  ==== */

type PrcRetUnion<T> = T extends Prc<infer U>[] ? U : never

export function any<PrcS extends Prc[]>(prcS: PrcS): AnyCh<PrcRetUnion<PrcS>> {
	return _any<PrcRetUnion<PrcS>>(prcS, "RESUME_WITH_VAL")
}

export function anyPrc<PrcS extends Prc[]>(prcS: PrcS): AnyCh<(PrcS)[number]> {
	return _any<(PrcS)[number]>(prcS, "RESUME_WITH_PRC")
}


function _any<ResumeType>(toWatchPrcS: Array<Prc>, resumeWith: "RESUME_WITH_VAL" | "RESUME_WITH_PRC") {
	for (const toWatchPrc of toWatchPrcS) {
		toWatchPrc._addReceiver(resumeWith)
	}
	return new AnyCh<ResumeType>(toWatchPrcS.length)
}


class AnyCh<V> {

	#nWatchedPrcsDone: number

	constructor(nWatchedPrcs: number) {
		this.#nWatchedPrcsDone = nWatchedPrcs
	}

	get rec(): Gen<V> {
		return this.#rec()
	}

	*#rec(): Gen<V> {
		const msg = yield PARK  // this will be a prc or a prc._doneVal
		this.#nWatchedPrcsDone -= 1
		return msg as V
	}

	notDone() {
		if (this.#nWatchedPrcsDone === 0) return false
		return true
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
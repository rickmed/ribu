import { csp, getRunningPrc } from "./initCsp.js"
import { Ch, addRecPrcToCh, isCh } from "./channel.js"
import { E, err, ECancOK, EUncaught } from "./errors.js"
import { PARK, RESUME, UNSET, genCtor } from "./utils.js"




const RESUME_WITH_VAL = 1
const RESUME_WITH_PRC = 2
type ResumeWith = typeof RESUME_WITH_VAL | typeof RESUME_WITH_PRC | undefined

const args = Symbol()
const name = Symbol()
export const IOmsg = Symbol()
const sleepTimeout = Symbol()

export class Prc<Ret = unknown> {

	#gen: Gen
	#internal: boolean = false;
	[args]?: unknown[];
	[name]?: string

	#state: PrcState = "RUNNING"

	/**
	 * A Set is needed since children can add/remove in arbitrary order
	 */
	#childS?: Set<Prc>
	#parent?: Prc;

	[IOmsg]?: unknown
	#resumeWith?: ResumeWith

	#waitingReceivers?: Prc | Array<Prc>
	#doneV?: DoneVal<Ret> | UNSET = UNSET;

	[sleepTimeout]?: NodeJS.Timeout
	onCancel?: OnCancel

	constructor(gen: Gen, internal: boolean) {
		this.#gen = gen
		this.#internal = internal

		if (!internal) {
			let parent = csp.runningPrc
			if (parent) {
				this.#parent = parent
				if (parent.#childS === undefined) {
					parent.#childS = new Set()
				}
				parent.#childS.add(this)
			}
		}
	}


	_resume(): void {

		if (this.#state !== "RUNNING") {
			return
		}

		csp.prcStack.push(this)

		for (; ;) {

			try {
				var { done, value } = this.#gen.next()  // eslint-disable-line no-var
			}
			catch (thrown) {
				console.log({thrown})
				_go(this.#handleThrownErr, thrown)
				return
			}

			csp.prcStack.pop()
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

	/**
	 * Optionally, use .done getter a for faster alternative
	 * @example
	 * const x = yield* prc.rec
	 */
	get rec() {
		return this.#_rec()
	}

	*#_rec<Ret>(): Gen<Ret> {
		const doneV = this.#doneV
		if (doneV !== UNSET) {
			return doneV
		}

		this._addReceiver(RESUME_WITH_VAL)

		const msg = yield PARK
		return msg as Ret
	}

	/**
	 * @example
	 * const x: Done<typeof prc> = yield prc.done
	 */
	get done() {
		this._addReceiver(RESUME_WITH_VAL)
		return PARK
	}

	get doneVal() {
		return this.#doneV
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
		const state = this.#state

		if (state === "DONE") {  // late .cancel() callers.
			// can be runn
			// waitingCancel._addReceiver(receiverPrc)
			// can be in process of finisNormalDone ??
			waitingCancel.resumeAll(undefined)
			return undefined
		}

		if (state === "CANCELLING") {
			addReceiver(waitingCancel, callingPrc)
			return undefined
		}

		this.#state = "CANCELLING"
		const sleepTimeout = this[sleepTimeout]
		if (sleepTimeout) clearTimeout(sleepTimeout)

		const res = yield* runOnCancelAndChildSCancel(this)

		this.#state = "DONE"
		return
	}

	_addReceiver(resumeWith: ResumeWith) {
		let recPrc = getRunningPrc()
		recPrc.#resumeWith = resumeWith

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
			const resumeRecPrcWith = recPrc.#resumeWith

			const msg =
				resumeRecPrcWith === RESUME_WITH_VAL ? this_.#doneV :
					resumeRecPrcWith === RESUME_WITH_PRC ? this_ :
						undefined

			recPrc._resume(msg)
		}
	}

	#finishNormalDone(doneVal: unknown) {
		this.#state = "DONE"
		this.#doneV = doneVal
		this.#parent = undefined
		// no need to prc.childS = undefined since this function is called when no active children
		this.#resumeReceivers()
	}



	*#waitChildS() {
		this.#state = "DONE"  // concurrent cancelling ??
		// cast ok. this fn is only called when childS !== undefined
		const childS = [...this.#childS!]

		const doneCh = anyVal(childS)

		let doneVal

		while (doneCh.notDone) {  // eslint-disable-line
			const res = yield* doneCh.rec

			if (err(res)) {

				// ok so a child just return an Exc
				// if cancel returned exception I think I need to mangle all up in a "Something" Err

				const cancelRes = yield tryCancel(childS)
				if (err(cancelRes)) {
					this.#doneV = cancelRes
				}
				doneVal = res
			}
		}

		this.#doneV = doneVal
		this.#resumeReceivers()
		return
	}

	/**
* If a prc throws anywhere, its onCancel is ran (tried) and children are cancelled.
* The result of that operation is placed in its done channel
*/
	*#handleThrownErr(prc: Prc, thrown: unknown) {
		prc.#state = "DONE"


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
	const wonPrc: Prc = yield* any($onCancel, Timeout.new(prc.deadline)).rec
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
	prc._resume(undefined)
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
	prc._resume(undefined)
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
	let runningPrc = getRunningPrc()

	const timeoutID = setTimeout(function _sleep() {
		runningPrc._resume(undefined)
	}, ms)

	runningPrc[sleepTimeout] = timeoutID
	return PARK
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

export function anyPrc<PrcS extends Prc[]>(prcS: PrcS): AnyCh<(PrcS)[number]> {
	return any<(PrcS)[number]>(prcS, RESUME_WITH_PRC)
}


type PrcRetUnion<T> = T extends Prc<infer U>[] ? U : never

export function anyVal<PrcS extends Prc[]>(prcS: PrcS): AnyCh<PrcRetUnion<PrcS>> {
	return any<PrcRetUnion<PrcS>>(prcS, RESUME_WITH_VAL)
}


function any<ResumeType>(toWatchPrcS: Array<Prc>, resumeWith: ResumeWith) {
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

type PrcState = "RUNNING" | "CANCELLING" | "DONE"


type PrcRet<Prc_> = Prc_ extends Prc<infer Ret> ? Ret : never
type DoneVal<PrcRet> = PrcRet | EPrcCancelled | E<"Unknown">
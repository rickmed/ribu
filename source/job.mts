import { ArrSet, Events } from "./dataStructures.mjs"
import { RibuE, newECancOK, CancOKClass, type ECancOK, newErr, ErrClass, type Err } from "./errors.mjs"
import { runningJob, sys, theIterator } from "./system.mjs"

import util from "node:util"


/* Helpers */
const GenFn = (function* () { }).constructor

function isGenFn(x: unknown): x is RibuGenFn {
	return x instanceof GenFn
}

function toErr(x: unknown): Error {
	return x instanceof Error ? x : newErr(JSON.stringify(x))
}

const tryFnFailed = Symbol("fnE")
export const YIELD_PARK = "#$YIELD_PARK*&"

/* observe-resume model:

	- Things subscribe to job._on(EV.JOB_DONE, cb) event when want to be notified
	when observingJob is done.

	- Jobs observing other jobs (yield*) insert cb :: (jobDone) => observer._resume()
		- There's no way for user to stop observing a job.
			- When yield* job.cancel() is called and additional observer is added,
			and the other observers (yield* job.$) are resumed when job settles
			(with CancOK|Errors in this case)

	- Cancellation (and removal of things I'm observing)
		- Set callbacks (eg: setTimeout) need to be removed on cancellation
			(as opposed of cb being "() => if job === DONE; return")
		bc, eg, nodejs won't end process if timeout cb isn't cleared.

	- Channels:
		- Removing a job from within a queue is expensive, so channel checks
		if job === DONE and skips it (removed from queue and not resumed)
*/

/* Internals:

- Things IO/Comms model:
	- job.resume(IOmsg) to have job receive some value and act on it
	- set job.val = IOmsg to whichever observer to consume.


- When yield* is called, [Symbol.iterator]() which returns the iterable,
	- iterable.next() is called
		.next() checks if iterable is "PARK" and returns {done: false}
			- or {done: true, value: iterable.val}

*/
type NotErrs<Ret> = Exclude<Ret, Error>
type OnlyErrs<Ret> = Extract<Ret, Error>

export function go<Args extends unknown[], Ret>(genFn: RibuGenFn<Ret, Args>, ...args: Args) {
	const gen = genFn(...args)
	return new Job<NotErrs<Ret>, OnlyErrs<Ret> | ECancOK | Err>(gen, genFn.name, true)
}


/***  Job class  ***/

/* Events names */
const EV = {
	JOB_DONE: "job.done",
	JOB_DONE_WAITCHILDS: "job.done.waitChilds"
} as const


/* Types */
export type Yield_Park = typeof YIELD_PARK
type Yieldable = Yield_Park | Promise<unknown>

export type Gen<Ret = unknown, Rec = unknown> =
	Generator<Yieldable, Ret, Rec>

type RibuGenFn<Ret = unknown, Args extends unknown[] = unknown[]> =
	(...args: Args) => Generator<Yieldable, Ret>

type FnOf<T = unknown> = () => T
type OnEnd =
	FnOf | Disposable |
	FnOf<PromiseLike<unknown>> | AsyncDisposable | RibuGenFn

type State = "RUN" | "PARK" | "WAIT_CHILDS" | "CANC" | "DONE"

export class Job<Ret = unknown, Errs = unknown> extends Events {

	_val_m: Ret | Errs = "$dummy" as (Ret | Errs)
	_gen: Gen
	_name: string
	_state: State = "RUN"
	_next_m?: "cont" | "$"  // todo: implement with ._state
	_childs?: ArrSet<Job<Ret>>
	_parent?: Job
	_sleepTO?: NodeJS.Timeout
	_onEnd?: OnEnd | OnEnd[]

	constructor(gen: Gen, genFnName: string, withParent?: boolean) {
		super()
		this._gen = gen
		this._name = genFnName
		if (withParent) {
			this.#addAsChild()
		}
		this._resume()
	}

	get val() {
		return this._val_m
	}

	#addAsChild() {
		let parent = sys.running
		if (!parent) return
		let parentCs = parent._childs
		if (!parentCs) parent._childs = parentCs = new ArrSet()
		parentCs.add(this)
		this._parent = parent
	}

	_resume(IOval?: unknown): void {

		sys.stack.push(this)
		this._setResume(IOval)

		try {
			// eslint-disable-next-line no-var
			var yielded = this._gen.next()
		}
		catch (e) {
			this._endProtocol(toErr(e))
			return
		}

		sys.stack.pop()

		if (yielded.value === YIELD_PARK) {
			return
		}

		if (yielded.done) {
			this.#genFnReturned(yielded.value as Ret)
		}
	}

	_setResume(IOval?: unknown) {
		this._state = "RUN"
		this._val_m = IOval as Ret
	}

	_setPark(IOval?: unknown) {
		this._state = "PARK"
		this._val_m = IOval as Ret
	}

	#genFnReturned(yieldVal: Ret) {
		this._val_m = yieldVal
		if (this._childs?.size) this.#waitChilds()
		else this._endProtocol()
	}

	#waitChilds() {

		this._state = "WAIT_CHILDS"
		const childs = this._childs!
		const self = this

		let nCs = childs.size
		let nCsDone = 0

		for (let i = 0; i < nCs; i++) {
			const c = childs.arr_m[i]
			if (c) c._on(EV.JOB_DONE_WAITCHILDS, cb)
		}

		function cb(childDone: Job) {
			++nCsDone
			if (childDone._val_m instanceof Error) {
				self._offWaitChildsCBs()
				self._endProtocol(undefined, [childDone._val_m as Error])
				return
			}
			if (nCsDone === nCs) {
				self._endProtocol()
			}
		}

	}

	_offWaitChildsCBs() {
		const cs = this._childs!
		const csL = cs.size
		for (let i = 0; i < csL; i++) {
			const c = cs.arr_m[i]
			if (c) c._offAll(EV.JOB_DONE_WAITCHILDS)
		}
	}

	get $() {
		this.#prepOp()
		return awaitJobIterable as RibuIterable<Ret>
	}

	get orEnd() {
		return this.$
	}

	get cont() {
		this.#prepOp(true)
		return awaitJobIterable as RibuIterable<Errs>
	}

	/**
	 * Fails caller if result is other than ECancOK
	 */
	cancel() {
		this.#prepOp()
		return cancelIterable as RibuIterable<undefined>
	}

	cancelHandle() {
		this.#prepOp(true)
		return cancelIterable as RibuIterable<ErrClass | undefined>
	}

	#prepOp(isCont = false) {
		runningJob()._next_m = isCont ? "cont" : "$"
		sys.targetJ = this
	}

	_endProtocol(causeErr?: Error, endsErr?: Error[]) {
		const { _childs: cs, _sleepTO, _onEnd: ends } = this

		if (_sleepTO) clearTimeout(_sleepTO)

		if (!(ends || (cs && cs.size > 0))) {
			this.#_settle(causeErr, endsErr)
			return
		}

		const self = this
		let nAsyncWaiting = 0
		let nAsyncDone = 0

		if (cs) {
			nAsyncWaiting += cs.size
			const { arr_m } = cs
			const chsL = arr_m.length
			for (let i = 0; i < chsL; i++) {
				const c = arr_m[i]
				if (c) {
					c.cancel()
					c._on(EV.JOB_DONE, jDone)
				}
			}
		}

		if (ends) {
			if (Array.isArray(ends)) {
				const l = ends.length
				for (let i = l; i >= 0; --i) {  // called LastIn-FirstOut
					execEnd(ends[i]!)
				}
			}
			else execEnd(ends)
		}

		function execEnd(x: OnEnd): void {
			if (isGenFn(x)) {
				++nAsyncWaiting
				new Job(x(), x.name)._on(EV.JOB_DONE, jDone)
			}
			else if (x instanceof Function) {
				const ret = tryFn(x)
				if (ret === tryFnFailed) return
				if (isProm(ret)) {
					++nAsyncWaiting
					ret.then(() => asyncDone(), x => asyncDone(toErr(x)))
				}
			}
			else if (Symbol.dispose in x) {
				tryFn(x[Symbol.dispose].bind(x))
			}
			else {
				++nAsyncWaiting
				x[Symbol.asyncDispose]().then(() => asyncDone(), x => asyncDone(toErr(x)))
			}
		}

		function tryFn(fn: FnOf) {
			try {
				// eslint-disable-next-line no-var
				var res = fn()
			}
			catch (e) {
				if (!endsErr) endsErr = []
				endsErr.push(toErr(e))
				return tryFnFailed
			}
			return res
		}

		function asyncDone(err?: Error) {
			++nAsyncDone
			if (err) {
				if (!endsErr) endsErr = []
				endsErr.push(err)
			}
			if (nAsyncDone === nAsyncWaiting) {
				self.#_settle(causeErr, endsErr)
			}
		}

		function jDone(j: Job) {
			asyncDone(j._val_m instanceof ErrClass ? j._val_m as Error : undefined)
		}
	}

	#_settle(causeErr?: Error, onEndErrs?: Error[]) {
		const { _state } = this
		const jName = this._name

		const msg = _state === "CANC" ? `Cancelled by ${this._val_m}` : ""

		if (causeErr || onEndErrs) {

			let endVal = causeErr ?
				newErr(msg, causeErr, onEndErrs, jName) :
				newErr(msg, undefined, onEndErrs, jName)
		
			this._val_m = endVal as Ret
		}
		else {
			if (_state === "CANC") {
				// this._val as job.name is reused (hack) since this._val won't be used
				// by genFn's return val
				this._val_m = newECancOK(msg, jName) as Ret
			}
			if (this._val_m instanceof RibuE && this._val_m._op !== "") {
				// @ts-ignore (._op$ being readonly)
				this._val_m._op = jName
			}
		}

		this._state = "DONE"
		this._parent?._childs!.delete(this)
		this._parent = undefined
		// todo: can optimized to be in Job since a job has only max 1 parent waiting for it.
		this._emit(EV.JOB_DONE_WAITCHILDS, this)
		this._emit(EV.JOB_DONE, this)
	}

	// // todo
	// settle(val: Ret) {
	// 	// what if job is cancelling itself (or waiting for childs?)
	// 	// maybe a special Job class??
	// }

	onEnd(newV: OnEnd) {
		let currV = this._onEnd
		if (!currV) this._onEnd = newV
		else if (Array.isArray(currV)) currV.push(newV)
		else this._onEnd = [currV, newV]
	}

	then(thenOK: (value: Ret) => Ret, thenErr: (reason: unknown) => unknown ): Promise<Ret | unknown> {

		return new Promise<Ret>((res, rej) => {

			this._on(EV.JOB_DONE, ({ val }: Job) => {
				if (val instanceof Error) {
					rej(val)
				}
				else {
					res(val as Ret)
				}
			})

		}).then<Ret, unknown>(thenOK, thenErr)
	}


}

export function onEnd(x: OnEnd) {
	runningJob().onEnd(x)
}


/* Job Iterables */

export let theIterResult = {
	done: false,
	value: 0 as unknown,
}


type RibuIterable<V> = {
	[Symbol.iterator](): Iterator<Yieldable, V>
}

const awaitJobIterable = {
	[Symbol.iterator]() {
		let callerJ = runningJob()
		const { targetJ } = sys

		if (targetJ._state !== "DONE") {

			targetJ._on(EV.JOB_DONE, (j: Job) => {
				if (callerJ._next_m === "$" && j._val_m instanceof Error) {
					callerJ._endProtocol(j._val_m)
				}
				else {
					callerJ._resume(j._val_m)
				}
			})

			callerJ._setPark()
			return theIterator
		}

		if (callerJ._next_m === "$" && targetJ._val_m instanceof Error) {
			throw targetJ._val_m
		}

		callerJ._setResume(targetJ._val_m)
		return theIterator
	}
}


function onTargeJDoneAfterCancel(j: Job, callerJ: Job) {
	const jVal = j._val_m
	if (callerJ._next_m === "$") {
		if (jVal instanceof CancOKClass) {
			callerJ._resume(jVal)
		}
		else {
			callerJ._endProtocol(jVal as Error)
		}
	}
	else {
		callerJ._resume(jVal instanceof CancOKClass ? undefined : jVal)
	}
}

const cancelIterable = {
	[Symbol.iterator]() {
		const callerJ = runningJob()
		const { targetJ } = sys
		const targetJState = targetJ._state

		// this._val as job.name is reused (hack) since this._val won't be used
		// by genFn's return val
		targetJ._val_m = callerJ._name

		if (targetJState !== "DONE") {

			if (targetJState === "WAIT_CHILDS") {
				targetJ._offWaitChildsCBs()
			}

			targetJ._on(EV.JOB_DONE, (j: Job) => onTargeJDoneAfterCancel(j, callerJ))

			if (targetJState !== "CANC") {
				targetJ._endProtocol()
			}

			callerJ._setPark()
			targetJ._state === "CANC"
			return theIterator
		}

		if (callerJ._next_m === "$" && targetJ instanceof Error && !(targetJ instanceof CancOKClass)) {
			// caught by resume() at gen.next()
			throw targetJ._val_m
		}

		callerJ._setResume(targetJ._val_m)
		return theIterator
	}

}










function isProm(x: unknown): x is PromiseLike<unknown> {
	return (x !== null && typeof x === "object" &&
		"then" in x && typeof x.then === "function")
}



/** Ports
 // ports<_P extends Ports>(ports: _P) {
 // 	const prcApi_m = ports as WithCancel<_P>
 // 	// Since a new object is passed anyway, reuse the object for the api
 // 	prcApi_m.cancel = this.cancel.bind(this)
 // 	return prcApi_m
 // }
 *
 */
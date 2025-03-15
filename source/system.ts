import { Err } from "ribu"
import { type Job } from "./job.ts"

/* *************  Lexicon   ****************************************************

ob: Observer
	- Waits for a Target to call back with data/result.
	- Has a refence to target/s for potential canncellation.
	- Job, Select, Promise, etc.

tg: Target
	- Calls back to observer/s with data/result.
	- Job, Chan, Select, etc.

Yieldable:
	- An object/method that can block a job, by using yield* or yield*.
	- Sleep, Chan.rec/put, etc.

LL: Linked List

*/

export const EMPTY = Symbol("EM")

class System {
	#stack: Array<Job> = []  // todo: optimize to Linked List
	runningJob!: Job
	deadline = 5000
	callerJobToSetSt: Job["_st"] = 0
	yieldOp: Maybe<string> = null
	yieldable: Maybe<Yieldable> = null

	pushJob(job: Job) {
		this.runningJob = job
		this.#stack.push(job)
	}

	popJob() {
		this.#stack.pop()
		return this.runningJob = this.#stack.at(-1)!
	}
}

export type Yieldable = {
	execYield: (callerJob: Job, iterRes: IterRes) => void
	nm: string
}

export let sys = new System()

export type IterRes = IteratorResult<unknown>
export let iterRes = {
	done: false,
	value: 0 as unknown,
}

export type Itrtor<V> = Iterator<unknown, V>
export const iterator = {
	next() {
		return iterRes
	}
}

export type _Iterable<V> = {
	[Symbol.iterator]: () => Itrtor<V>
}
export const iterable = {
	[Symbol.iterator]() {
		sys.yieldable!.execYield(sys.runningJob, iterRes)
		sys.yieldable = null
		return iterator
	}
}

export function sysIterable<YieldRet>(yieldable: Yieldable) {
	// todo: (also would need to do it in objects that have Symbol.iterator directly)
	// if (sys.yieldable) {
	// 	// throw new Error(`Forgot to call yield* at ${sys.runningJob._nm}`)
	// }
	sys.yieldable = yieldable
	return iterable as _Iterable<YieldRet>
}

export function cleanSysOpSetup() {
	sys.callerJobToSetSt = 0
	sys.yieldOp = null
}

export function setYieldOp(op: string, callerJobNextSt: Job["_st"]) {
	const { yieldOp } = sys
	if (yieldOp) {
		const errMsg = `
			RIBU: Did you forget to yield* at operation before this one?
			Previous operation: ${yieldOp}
			Current operation: ${op}
		`
		// eslint-disable-next-line @typescript-eslint/only-throw-error
		throw Err("RibuErr", sys.runningJob._nm, errMsg)
	}

	sys.callerJobToSetSt = callerJobNextSt
	sys.yieldOp = op
}


/** Observer
 * _onTgDone = onTargetDone
 * 	Target calls this to notify me with data/result.
 * _tg = targets LL Head
 * 	Head of targets LL that I'm awaiting data/result.
 *		Needed to remove Observer from all targets if cancelled.
 * _addTg = addTarget to ._tg
 * _rmTg = removeTarget from ._tg
 */
export type Ob = {
	_tg: Maybe<Link<Ob, Tg>>
	_addTg: (link: Link<Ob, Tg>) => void
	_rmTg: (link: Link<Ob, Tg>) => void
	_onTgDone: (val: unknown, tg: Tg) => void
}

/** Target
 * _ob: Link<Ob, Tg>,
 * 	Head of observers LL that I will call back with data/result
 * _addOb = addObserver to ._ob
 * _rmOb = removeObserver from ._ob
 */
export type Tg = {
	_ob: Maybe<Link<Ob, Tg>>
	_addOb: (link: Link<Ob, Tg>) => void
	_rmOb: (link: Link<Ob, Tg>) => void
	_st: number
	val: unknown
}


export type Maybe<T> = T | null

/** Link
 * Used as a Doubly LL Node for Observers <-> Targets and several other
 * LLs (some are Singly LL).
 * "Link" terminology is used to differentiate from Node std type.
 * A is Observer (or a generic object)
 * B is Target (or a generic object)
 * nA is next ObjectA Link (towards the tail of LL)
 * pA is previous ObjectA Link
 * nB is next ObjectB Link (towards the tail of LL)
 * pB is previous ObjectB Link
 */
export class Link<A = unknown, B = unknown> {
	constructor(
		public a: A,
		public b: B,
	) {}
	nA: Maybe<Link<A, B>> = null
	pA: Maybe<Link<A, B>> = null
	nB: Maybe<Link<A, B>> = null
	pB: Maybe<Link<A, B>> = null
}

export type MaybeLink = Maybe<Link>

/**
 * Pool of links to be reused.
 * Is a single LL.
 * We use Link's .nA to link to next available Link in pool.
 * todo: manage pool size
 */
let linkPoolHead: Maybe<Link> = null

export function disposeLink(link: Link) {

	link.nA = linkPoolHead
	linkPoolHead = link

	link.a = null
	link.b = null
	link.pA = null
	link.nB = null
	link.pB = null
}

export function freshLink<A, B>(a: A, b: B) {
	if (!linkPoolHead) {
		return new Link(a, b)
	}

	let link = linkPoolHead
	linkPoolHead = link.nA
	link.nA = null

	link.a = a
	link.b = b

	return link as Link<A, B>
}

export function linkObAndTg(ob: Ob, tg: Tg) {
	const link = freshLink(ob, tg)
	ob._addTg(link)
	tg._addOb(link)
}

export function unlinkObAndTg(link: Link<Ob, Tg>) {
	link.a._rmTg(link)
	link.b._rmOb(link)
	disposeLink(link)
}

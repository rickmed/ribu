import { Err } from "./errors.js"
import { type Job } from "./job.js"

class System {
	#stack: Array<Job> = []  // todo: optimize to Linked List
	runningJob: Job = VOID_OBJ as unknown as Job
	deadline = 5000
	callerJobNextSt: Job["_st"] = 0
	yieldOp = 0 as YieldOp
	yieldOpStr = ""

	pushJob(job: Job) {
		this.runningJob = job
		this.#stack.push(job)
	}

	popJob() {
		this.#stack.pop()
		return this.runningJob = this.#stack.at(-1)!
	}
}

export let sys = new System()


export const SLEEP_OP = 1
type YieldOp = typeof SLEEP_OP


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
		(sys.yieldable as Yieldable).execYield(sys.runningJob, iterRes)
		sys.yieldable = VOID_OBJ
		return iterator
	}
}

export function sysIterable<YieldRet>(yieldable: Yieldable) {
	sys.yieldable = yieldable
	return iterable as _Iterable<YieldRet>
}


export function setYieldOp(op: string, callerJobNextSt: Job["_st"]) {
	const { yieldOpStr: yieldOp } = sys
	if (yieldOp !== "") {
		const errMsg = `
			RIBU: Did you forget to yield* at operation before this one?
			Previous operation: ${yieldOp}
			Current operation: ${op}
		`
		// eslint-disable-next-line @typescript-eslint/only-throw-error
		throw new Err("RibuErr", sys.runningJob._nm, undefined, errMsg)
	}

	sys.callerJobNextSt = callerJobNextSt
	sys.yieldOpStr = op
}


export const VOID_OBJ = {
	_vo: true,
}
export type VoidObj = typeof VOID_OBJ


//* ********************  Linked Lists  ************************************ *//

export let VOID_LINK: Link<VoidObj, VoidObj>
export type VoidLink = typeof VOID_LINK

export type MaybeL<T> = T | VoidLink

/** Link
 * Used as a Doubly LL Node for Observers <-> Targets and several other
 * 	LLs (some are Singly LL).
 * "Link" terminology is used to differentiate from Node std type.
 * A is Observer (or a generic object A)
 * B is Target (or a generic object B)
 * nA is next object A Link (towards the tail of LL)
 * pA is previous object A Link
 * nB is next object B Link (towards the tail of LL)
 * pB is previous object B Link
 */
export class Link<A = unknown, B = unknown> {
	a: A
	b: B
	nA: this | VoidLink = VOID_LINK
	nB: this | VoidLink = VOID_LINK
	pA: this | VoidLink = VOID_LINK
	pB: this | VoidLink = VOID_LINK
	constructor(a: A, b: B) {
		this.a = a
		this.b = b
	}
}

VOID_LINK = new Link(VOID_OBJ, VOID_OBJ)


/** Link Pool
 * Is a single LL.
 * We use Link's .nA to link to next available Link in pool.
 * todo: manage pool size
 */
let linkPoolHead = VOID_LINK
let linkPoolSize = 0
export function getLinkPoolSize() {
	return linkPoolSize
}

export function disposeLink(link: Link) {
	linkPoolSize++

	link.nA = linkPoolHead
	linkPoolHead = link

	link.a = VOID_OBJ
	link.b = VOID_OBJ
	link.pA = VOID_LINK
	link.nB = VOID_LINK
	link.pB = VOID_LINK
}

export function freshLink<A, B>(a: A, b: B) {
	if (linkPoolHead === VOID_LINK) {
		return new Link(a, b)
	}

	linkPoolSize--

	let link = linkPoolHead
	linkPoolHead = link.nA

	link.nA = VOID_LINK
	link.a = a
	link.b = b
	// caller will reassign next and prev links

	return link as Link<A, B>
}

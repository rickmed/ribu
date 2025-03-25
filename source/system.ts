import { Err } from "./errors.js"
import { PARKED, type Job } from "./job.js"


export const VOID_OBJ = { _v: 0 } as const
Object.freeze(VOID_OBJ)
export type VoidObj = typeof VOID_OBJ


class System {
	#stack: Array<Job> = []  // todo: optimize to Linked List
	runningJob = null as unknown as Job
	deadline = 5000

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
		return iterator
	}
}


export function ensurePreviousYieldAndSetCallerJobNextSt(callerJobNextSt: Job["_st"], opName: string) {
	const callerJob = sys.runningJob
	if (callerJob._st & PARKED) {
		throwNotYieldedErr(opName)
	}
	// eslint-disable-next-line functional/immutable-data
	callerJob._st |= callerJobNextSt
}

export function throwNotYieldedErr(currentOp: string) {
	const errMsg = `
		Ribu: Did you forget to yield* at the operation before this one?
		Current yieldable operation: ${currentOp}.
		Job: ${sys.runningJob._nm}.
	`
	// eslint-disable-next-line @typescript-eslint/only-throw-error
	throw new Err("RibuErr", "", undefined, undefined, errMsg)
}


//* ********************  Linked Lists  ************************************ *//

export let VOID_LINK = {
	a: VOID_OBJ,
	b: VOID_OBJ,
} as Link<VoidObj, VoidObj>

// Set to same object type as Link ctor to prevent V8 to deopt, maybe.
VOID_LINK.nA = VOID_LINK
VOID_LINK.pA = VOID_LINK
VOID_LINK.nB = VOID_LINK
VOID_LINK.pB = VOID_LINK

Object.freeze(VOID_LINK)

export type VoidLink = typeof VOID_LINK

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
 */ export interface Link<A = unknown, B = unknown> {
	a: A
	b: B
	nA: this | VoidLink
	pA: this | VoidLink
	nB: this | VoidLink
	pB: this | VoidLink
}

function newLink<A, B>(a: A, b: B): Link<A, B> {
	return {
		a,
		b,
		nA: VOID_LINK,
		pA: VOID_LINK,
		nB: VOID_LINK,
		pB: VOID_LINK,
	}
}

/** Link Pool
 * Is a single LL.
 * We use Link's .nA to link to next available Link in pool.
 * todo: manage pool size
 */
let linkPoolHead: Link | VoidLink = VOID_LINK
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

export function freshLink<A, B>(a: A, b: B): Link<A, B> {
	if (linkPoolHead === VOID_LINK) {
		return newLink(a, b)
	}

	linkPoolSize--

	let link = linkPoolHead
	linkPoolHead = link.nA

	link.nA = VOID_LINK
	link.a = a
	link.b = b

	return link as Link<A, B>
}
